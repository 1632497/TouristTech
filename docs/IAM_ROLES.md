# TouristTech – Cloud IAM Roles & Permissions

## Service Account: `touristtech-function-sa`

This is the identity assigned to the Cloud Function. Terraform automatically creates it, but if creating manually:

```bash
gcloud iam service-accounts create touristtech-function-sa \
  --display-name="TouristTech Cloud Function SA" \
  --project=touristtech-prod
```

---

## Required IAM Role Bindings

Grant each role at the **project level** unless a more restrictive scope is noted.

| # | Role (ID)                                        | Display Name                        | Why it's needed |
|---|--------------------------------------------------|-------------------------------------|-----------------|
| 1 | `roles/storage.objectAdmin`                       | Storage Object Admin                | Read input images from the trigger bucket AND write MP3 audio to the audio bucket. |
| 2 | `roles/cloudsql.client`                           | Cloud SQL Client                    | Connect to the Cloud SQL (PostgreSQL) instance via the Cloud SQL Auth Proxy. |
| 3 | `roles/cloudvision.user` **(or)**                 | Cloud Vision API User               | Call the Vision API for OCR text detection on the uploaded image. |
|   | `roles/serviceusage.serviceUsageConsumer`         | Service Usage Consumer              | (Needed together with Vision User) |
| 4 | `roles/aiplatform.user`                           | Vertex AI User                      | Call Gemini via the Vertex AI API (`generateContent`). |
| 5 | `roles/cloudtranslate.user`                       | Cloud Translation API User          | Translate the Gemini output to the user's native language. |
| 6 | `roles/cloudtexttospeech.user`                    | Cloud Text-to-Speech User           | Synthesize the translated text into MP3 audio. |
| 7 | `roles/logging.logWriter`                         | Logs Writer                         | Write structured logs to Cloud Logging. |
| 8 | `roles/monitoring.metricWriter`                   | Monitoring Metric Writer            | Emit metrics for Cloud Monitoring dashboards. |

*(All of these are automatically configured if using Terraform)*
