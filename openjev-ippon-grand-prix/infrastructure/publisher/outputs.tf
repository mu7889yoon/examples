output "artifact_bucket_name" {
  description = "Private, versioned bucket containing content-addressed MicroVM runtime artifacts."
  value       = aws_s3_bucket.artifacts.bucket
}

output "artifact_release_prefix" {
  description = "S3 prefix reserved for immutable MicroVM runtime releases."
  value       = var.artifact_release_prefix
}

output "publisher_project_name" {
  description = "CodeBuild project that publishes verified MicroVM artifacts."
  value       = aws_codebuild_project.microvm_publisher.name
}

output "publisher_log_group_name" {
  description = "CloudWatch log group for artifact publisher builds."
  value       = aws_cloudwatch_log_group.publisher.name
}
