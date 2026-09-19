output "frontend_bucket_name" {
  description = "Private S3 bucket to which static frontend files must be uploaded."
  value       = aws_s3_bucket.frontend.bucket
}

output "artifact_bucket_name" {
  description = "Publisher-owned private, versioned S3 bucket for deployment artifacts."
  value       = data.aws_s3_bucket.artifacts.bucket
}

output "microvm_artifact_key" {
  description = "Immutable content-addressed MicroVM artifact consumed by this deployment."
  value       = data.aws_s3_object.microvm.key
}

output "microvm_artifact_version_id" {
  description = "S3 VersionId recorded for the immutable MicroVM artifact."
  value       = data.aws_s3_object.microvm.version_id
}

output "cloudfront_domain_name" {
  description = "Public HTTPS hostname for the static frontend."
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "api_base_url" {
  description = "Regional REST API base URL. Configure the frontend with this value."
  value       = aws_api_gateway_stage.api.invoke_url
}

output "sessions_table_name" {
  description = "DynamoDB table holding session state."
  value       = aws_dynamodb_table.sessions.name
}

output "microvm_image_arn" {
  description = "Image ARN passed by Controller to RunMicrovm. This is an image, not a running MicroVM."
  value       = aws_cloudformation_stack.microvm_image.outputs["ImageArn"]
}

output "microvm_latest_active_image_version" {
  description = "Latest active version of the declaratively built MicroVM image."
  value       = aws_cloudformation_stack.microvm_image.outputs["LatestActiveImageVersion"]
}

output "microvm_image_state" {
  description = "Current state reported by the MicroVM image build stack."
  value       = aws_cloudformation_stack.microvm_image.outputs["State"]
}

output "microvm_runtime_role_arn" {
  description = "Runtime execution role passed by Controller to RunMicrovm."
  value       = aws_iam_role.microvm_runtime.arn
}

output "openrouter_api_key_secret_arn" {
  description = "Secrets Manager ARN for the OpenRouter API key container. The value is managed out-of-band."
  value       = aws_secretsmanager_secret.openrouter_api_key.arn
}

output "openrouter_api_key_secret_name" {
  description = "Secrets Manager name for the OpenRouter API key container."
  value       = aws_secretsmanager_secret.openrouter_api_key.name
}
