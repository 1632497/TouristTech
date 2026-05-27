# TouristTech 🌍🍽️

**TouristTech** is a multilingual tourist assistant and dietary safety filter. It translates restaurant menus via photo, detects ingredients using Gemini AI, filters for 12 different dietary restrictions, and provides audio narration for accessibility.

This repository contains the complete production-ready version, built with Vanilla HTML/JS frontend and a serverless Google Cloud Platform (GCP) backend.

## 🏗️ Architecture

```text
App Mòbil (Web App)
    ↓ (Puts photo)
Cloud Storage bucket (`touristtech-menu-images`)
    ↓ (Eventarc trigger)
Cloud Function (Node.js Gen2)
    ├── Cloud SQL (PostgreSQL)  → Reads user profile (language, restrictions)
    ├── Cloud Vision API        → Extracts raw text via OCR
    ├── Vertex AI (Gemini Pro)  → Identifies dishes, infers ingredients, filters safety
    ├── Cloud Translation API   → Translates to user's native language
    └── Cloud Text-to-Speech    → Generates MP3 audio narration (WaveNet)
         ↓
    Saves MP3 to Cloud Storage (`touristtech-audio-output`)
    Returns signed audio URL & structured JSON to frontend
```

## 🛠️ Tech Stack
- **Frontend**: Vanilla HTML5, CSS3, JavaScript
- **Backend (API)**: Node.js, Express (dual mode: Mock / Production GCP)
- **Database**: Cloud SQL (PostgreSQL 15)
- **Infrastructure**: Terraform (IaC)
- **Auth**: Firebase Authentication

---

## 🚀 Deployment Guide

### 1. GCP Project Setup
Create a GCP project and enable Billing.

### 2. Firebase Setup
1. Go to the [Firebase Console](https://console.firebase.google.com/) and create a project (link it to your GCP project).
2. Enable **Authentication** (Email/Password).
3. Register a Web App in Firebase settings to get your Firebase SDK config snippet.
4. Paste the config into `frontend/js/config.js`.

### 3. Terraform (Infrastructure as Code)
Deploy the Cloud SQL instance, Storage Buckets, IAM roles, and Cloud Function automatically.

```bash
cd backend/terraform
terraform init

# Create a terraform.tfvars file with your secrets:
# project_id  = "your-gcp-project"
# db_password = "SuperSecretPassword123"

terraform plan
terraform apply
```

### 4. Database Schema Migration
Connect to your new Cloud SQL instance and apply the schema:

```bash
# Obtain Cloud SQL IP from Terraform output
psql -h <CLOUD_SQL_IP> -U touristtech_user -d touristtech -f backend/sql/schema.sql
```

### 5. Running the Backend Locally
You can run the Express backend locally. It has two modes:

**Mock Mode (Default)**
Uses simulated responses. No GCP credentials needed. Fast for frontend dev.
```bash
cd backend
npm install
npm run dev
```

**Production Mode**
Connects to real GCP APIs. Requires `GOOGLE_APPLICATION_CREDENTIALS` or `gcloud auth application-default login`.
1. Copy `backend/.env.example` to `backend/.env`
2. Update the values with your Cloud SQL connection string and buckets.
3. Set `USE_MOCK=false`.
4. Run `npm run dev`.

### 6. Running the Frontend
The frontend uses standard web technologies. You can serve it using any HTTP server:

```bash
cd frontend
# Using Python
python -m http.server 8080
# Open http://localhost:8080
```

---

## 👤 User Flow

1. **Login/Signup**: Handled via Firebase Auth.
2. **Profile Setup**: Select from 12 dietary restrictions (Gluten, Lactose, Halal, Kosher, Vegan, etc.) and assign severity (Preference, Intolerance, Allergy).
3. **Capture**: Take a photo of a menu.
4. **Processing**: Sent securely to the backend via Firebase bearer token.
5. **Results**: Dishes are categorized as Safe (Green), Warning (Yellow), or Danger (Red). Original names and inferred ingredients are shown.
6. **Accessibility**: Listen to the menu translation using the generated MP3 audio player.
