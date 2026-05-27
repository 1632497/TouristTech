output "cloud_sql_connection_name" {
  value = google_sql_database_instance.db.connection_name
}

output "cloud_sql_ip" {
  value = google_sql_database_instance.db.public_ip_address
}

output "images_bucket" {
  value = google_storage_bucket.images_bucket.name
}

output "audio_bucket" {
  value = google_storage_bucket.audio_bucket.name
}

output "cloud_function_uri" {
  value = google_cloudfunctions2_function.process_menu.service_config[0].uri
}
