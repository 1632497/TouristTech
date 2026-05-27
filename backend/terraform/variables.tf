variable "project_id" {
  description = "The GCP Project ID"
  type        = string
}

variable "region" {
  description = "The GCP region to deploy resources"
  type        = string
  default     = "us-central1"
}

variable "images_bucket_name" {
  description = "Name for the Cloud Storage bucket that receives menu images"
  type        = string
  default     = "touristtech-menu-images-prod"
}

variable "audio_bucket_name" {
  description = "Name for the Cloud Storage bucket that stores generated audio"
  type        = string
  default     = "touristtech-audio-output-prod"
}

variable "db_user" {
  description = "Database user for Cloud SQL"
  type        = string
  default     = "touristtech_user"
}

variable "db_password" {
  description = "Database password for Cloud SQL"
  type        = string
  sensitive   = true
}
