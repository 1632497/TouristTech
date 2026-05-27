terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# =====================================================================
# Enable APIs
# =====================================================================
resource "google_project_service" "apis" {
  for_each = toset([
    "vision.googleapis.com",
    "translate.googleapis.com",
    "texttospeech.googleapis.com",
    "aiplatform.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "cloudfunctions.googleapis.com",
    "eventarc.googleapis.com",
    "run.googleapis.com",
    "cloudbuild.googleapis.com"
  ])
  service = each.key
  disable_on_destroy = false
}

# =====================================================================
# Cloud SQL (PostgreSQL 15)
# =====================================================================
resource "google_sql_database_instance" "db" {
  name             = "touristtech-db"
  database_version = "POSTGRES_15"
  region           = var.region

  settings {
    tier = "db-f1-micro"
    ip_configuration {
      ipv4_enabled = true
    }
  }
  deletion_protection = false # Set to true in production
  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "database" {
  name     = "touristtech"
  instance = google_sql_database_instance.db.name
}

resource "google_sql_user" "users" {
  name     = var.db_user
  instance = google_sql_database_instance.db.name
  password = var.db_password
}

# =====================================================================
# Cloud Storage Buckets
# =====================================================================
resource "google_storage_bucket" "images_bucket" {
  name          = var.images_bucket_name
  location      = var.region
  force_destroy = true
  
  cors {
    origin          = ["*"] # Restrict to frontend domain in production
    method          = ["GET", "PUT", "POST", "DELETE", "HEAD", "OPTIONS"]
    response_header = ["Content-Type", "x-goog-resumable", "Authorization"]
    max_age_seconds = 3600
  }
}

resource "google_storage_bucket" "audio_bucket" {
  name          = var.audio_bucket_name
  location      = var.region
  force_destroy = true
  
  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["*"]
    max_age_seconds = 3600
  }
}

# Make audio bucket publicly readable
resource "google_storage_bucket_iam_binding" "public_audio" {
  bucket = google_storage_bucket.audio_bucket.name
  role   = "roles/storage.objectViewer"
  members = [
    "allUsers",
  ]
}

# =====================================================================
# Service Account for Cloud Function
# =====================================================================
resource "google_service_account" "function_sa" {
  account_id   = "touristtech-function-sa"
  display_name = "TouristTech Cloud Function SA"
}

# IAM Role Bindings
resource "google_project_iam_member" "sa_roles" {
  for_each = toset([
    "roles/storage.objectAdmin",
    "roles/cloudsql.client",
    "roles/cloudvision.user",
    "roles/aiplatform.user",
    "roles/cloudtranslate.user",
    "roles/cloudtexttospeech.user",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter"
  ])
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.function_sa.email}"
}

# =====================================================================
# Cloud Function Gen2 Deployment
# =====================================================================
# Zip the function source code
data "archive_file" "function_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../functions/processMenuImage"
  output_path = "${path.module}/.terraform/tmp/function.zip"
}

# Upload zip to a staging bucket
resource "google_storage_bucket" "function_source_bucket" {
  name          = "${var.project_id}-function-source"
  location      = var.region
  force_destroy = true
}

resource "google_storage_bucket_object" "function_source" {
  name   = "processMenuImage-${data.archive_file.function_zip.output_md5}.zip"
  bucket = google_storage_bucket.function_source_bucket.name
  source = data.archive_file.function_zip.output_path
}

resource "google_cloudfunctions2_function" "process_menu" {
  name        = "processMenuImage"
  location    = var.region
  description = "Triggered by Cloud Storage to process menu images"

  build_config {
    runtime     = "nodejs20"
    entry_point = "processMenuImage"
    source {
      storage_source {
        bucket = google_storage_bucket.function_source_bucket.name
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    max_instance_count = 10
    min_instance_count = 0
    available_memory   = "512M"
    timeout_seconds    = 60
    
    service_account_email = google_service_account.function_sa.email

    environment_variables = {
      GCP_PROJECT_ID    = var.project_id
      GCP_LOCATION      = var.region
      GCP_IMAGES_BUCKET = google_storage_bucket.images_bucket.name
      GCP_AUDIO_BUCKET  = google_storage_bucket.audio_bucket.name
      GEMINI_MODEL      = "gemini-1.5-pro"
      DB_HOST           = "/cloudsql/${google_sql_database_instance.db.connection_name}"
      DB_PORT           = "5432"
      DB_NAME           = google_sql_database.database.name
      DB_USER           = google_sql_user.users.name
      DB_PASSWORD       = var.db_password
      NODE_ENV          = "production"
    }
  }

  event_trigger {
    trigger_region = var.region
    event_type     = "google.cloud.storage.object.v1.finalized"
    retry_policy   = "RETRY_POLICY_DO_NOT_RETRY"
    service_account_email = google_service_account.function_sa.email
    event_filters {
      attribute = "bucket"
      value     = google_storage_bucket.images_bucket.name
    }
  }

  depends_on = [
    google_project_iam_member.sa_roles,
    google_project_service.apis
  ]
}
