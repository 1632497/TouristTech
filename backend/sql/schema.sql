-- ============================================================
-- TouristTech - Cloud SQL (PostgreSQL 15) Schema
-- ============================================================
-- Run this script against your Cloud SQL instance:
--   psql -h <HOST> -U touristtech_user -d touristtech -f schema.sql
-- ============================================================

-- Enable UUID generation extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUM: dietary restriction types
-- ============================================================
DO $$ BEGIN
  CREATE TYPE restriction_type AS ENUM (
    'GLUTEN', 'LACTOSE', 'NUTS', 'SHELLFISH', 'EGGS', 'SOY',
    'PORK', 'ALCOHOL', 'VEGETARIAN', 'VEGAN', 'HALAL', 'KOSHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- ENUM: restriction severity
-- ============================================================
DO $$ BEGIN
  CREATE TYPE restriction_severity AS ENUM (
    'ALLERGY',       -- Life-threatening, zero tolerance
    'INTOLERANCE',   -- Causes discomfort but not life-threatening
    'PREFERENCE'     -- Personal/religious/ethical choice
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- Table: users
-- Stores basic user identity. firebase_uid links to Firebase Auth.
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firebase_uid  VARCHAR(128) UNIQUE,
    email         VARCHAR(255) UNIQUE NOT NULL,
    display_name  VARCHAR(255),
    native_language VARCHAR(10) NOT NULL DEFAULT 'ca',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Table: dietary_profiles
-- Normalized dietary restrictions per user.
-- One row per restriction (1-to-many relationship).
-- ============================================================
CREATE TABLE IF NOT EXISTS dietary_profiles (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    restriction_type  restriction_type NOT NULL,
    severity          restriction_severity NOT NULL DEFAULT 'PREFERENCE',
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Each user can only have one entry per restriction type
    CONSTRAINT uq_user_restriction UNIQUE (user_id, restriction_type)
);

-- ============================================================
-- Table: user_preferences (legacy compatibility with Hackathon schema)
-- Denormalized view for quick Cloud Function lookups.
-- One row per user (1-to-1 relationship).
-- ============================================================
CREATE TABLE IF NOT EXISTS user_preferences (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    native_language     VARCHAR(10)  NOT NULL DEFAULT 'ca',
    dietary_restrictions TEXT[],
    allergies           TEXT[],
    extra_notes         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_preferences_user UNIQUE (user_id)
);

-- ============================================================
-- Table: scan_history
-- Keeps a log of every menu/sign analysis performed.
-- The Cloud Function writes a row here after processing.
-- ============================================================
CREATE TABLE IF NOT EXISTS scan_history (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image_url         TEXT NOT NULL,
    ocr_raw_text      TEXT,
    gemini_result     TEXT,
    translated_text   TEXT,
    audio_gcs_url     TEXT,
    audio_public_url  TEXT,
    source_language   VARCHAR(10),
    target_language   VARCHAR(10),
    result_json       JSONB,
    status            VARCHAR(30) NOT NULL DEFAULT 'pending',
                                           -- 'pending' | 'processing' | 'done' | 'error'
    error_message     TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Indexes for common queries
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid
    ON users (firebase_uid);

CREATE INDEX IF NOT EXISTS idx_dietary_profiles_user_id
    ON dietary_profiles (user_id);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id
    ON user_preferences (user_id);

CREATE INDEX IF NOT EXISTS idx_scan_history_user_id
    ON scan_history (user_id);

CREATE INDEX IF NOT EXISTS idx_scan_history_created_at
    ON scan_history (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_history_status
    ON scan_history (status);

-- ============================================================
-- Helper function: auto-update updated_at on row changes
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for auto-updating timestamps
DO $$ BEGIN
  CREATE TRIGGER trg_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_dietary_profiles_updated_at
      BEFORE UPDATE ON dietary_profiles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_user_preferences_updated_at
      BEFORE UPDATE ON user_preferences
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_scan_history_updated_at
      BEFORE UPDATE ON scan_history
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- Function: sync dietary_profiles → user_preferences
-- Automatically keeps the denormalized user_preferences in sync
-- when dietary_profiles rows are inserted/updated/deleted.
-- ============================================================
CREATE OR REPLACE FUNCTION sync_user_preferences()
RETURNS TRIGGER AS $$
DECLARE
  target_user_id UUID;
BEGIN
  target_user_id := COALESCE(NEW.user_id, OLD.user_id);

  INSERT INTO user_preferences (user_id, native_language, dietary_restrictions, allergies)
  SELECT
    target_user_id,
    COALESCE(u.native_language, 'ca'),
    ARRAY(
      SELECT dp.restriction_type::TEXT
      FROM dietary_profiles dp
      WHERE dp.user_id = target_user_id
        AND dp.severity IN ('ALLERGY', 'INTOLERANCE')
    ),
    ARRAY(
      SELECT dp.restriction_type::TEXT
      FROM dietary_profiles dp
      WHERE dp.user_id = target_user_id
        AND dp.severity = 'ALLERGY'
    )
  FROM users u
  WHERE u.id = target_user_id
  ON CONFLICT (user_id) DO UPDATE SET
    dietary_restrictions = EXCLUDED.dietary_restrictions,
    allergies = EXCLUDED.allergies,
    updated_at = NOW();

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_sync_preferences_on_profile_change
      AFTER INSERT OR UPDATE OR DELETE ON dietary_profiles
      FOR EACH ROW EXECUTE FUNCTION sync_user_preferences();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- Seed data (for local dev / demo)
-- ============================================================
INSERT INTO users (id, firebase_uid, email, display_name, native_language) VALUES
    ('a1b2c3d4-0000-0000-0000-000000000001', 'demo-firebase-uid', 'demo@touristtech.app', 'Demo User', 'ca')
ON CONFLICT (id) DO NOTHING;

-- Insert demo dietary profiles
INSERT INTO dietary_profiles (user_id, restriction_type, severity, notes) VALUES
    ('a1b2c3d4-0000-0000-0000-000000000001', 'GLUTEN', 'ALLERGY', 'Celiac disease'),
    ('a1b2c3d4-0000-0000-0000-000000000001', 'NUTS', 'ALLERGY', 'Anaphylaxis risk')
ON CONFLICT (user_id, restriction_type) DO NOTHING;

-- Insert legacy user_preferences for the demo user
INSERT INTO user_preferences (user_id, native_language, dietary_restrictions, allergies, extra_notes) VALUES
    ('a1b2c3d4-0000-0000-0000-000000000001', 'ca', ARRAY['GLUTEN','NUTS'], ARRAY['GLUTEN','NUTS'], 'Celiac + nut allergy')
ON CONFLICT (user_id) DO NOTHING;
