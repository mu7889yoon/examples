variable "aws_region" {
  description = "AWS region used for all regional resources."
  type        = string
  default     = "ap-northeast-1"
}

variable "project_name" {
  description = "Lowercase project name used as the resource-name prefix."
  type        = string
  default     = "openjev-ippon-grand-prix"

  validation {
    condition     = can(regex("^[a-z0-9-]{1,40}$", var.project_name))
    error_message = "project_name must contain 1-40 lowercase letters, digits, or hyphens."
  }
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "poc"
}

variable "frontend_bucket_name" {
  description = "Optional globally unique frontend bucket name. Empty generates a unique name."
  type        = string
  default     = ""
}

variable "artifact_bucket_name" {
  description = "Name of the private, versioned artifact bucket created by infrastructure/publisher."
  type        = string

  validation {
    condition     = length(trimspace(var.artifact_bucket_name)) > 0
    error_message = "artifact_bucket_name must be the publisher Terraform output."
  }
}

variable "controller_lambda_artifact_key" {
  description = "S3 key to use for the controller Lambda deployment ZIP."
  type        = string
  default     = "lambda/controller.zip"
}

variable "controller_lambda_artifact_path" {
  description = "Local path of the controller Lambda deployment ZIP to upload during apply, relative to this Terraform directory unless absolute."
  type        = string
  default     = "../../artifacts/controller.zip"
}

variable "streaming_proxy_lambda_artifact_key" {
  description = "S3 key to use for the streaming-proxy Lambda deployment ZIP."
  type        = string
  default     = "lambda/streaming-proxy.zip"
}

variable "streaming_proxy_lambda_artifact_path" {
  description = "Local path of the streaming-proxy Lambda deployment ZIP to upload during apply, relative to this Terraform directory unless absolute."
  type        = string
  default     = "../../artifacts/streaming-proxy.zip"
}

variable "microvm_artifact_key" {
  description = "Immutable content-addressed MicroVM ZIP key printed by the CodeBuild publisher."
  type        = string

  validation {
    condition     = can(regex("^microvm/published/[0-9a-f]{40}/[0-9a-f]{64}/openjev-runtime\\.zip$", var.microvm_artifact_key))
    error_message = "microvm_artifact_key must be the immutable digest-addressed key printed by the publisher."
  }
}

variable "frontend_dist_path" {
  description = "Directory containing the Vite production build to upload to the private frontend bucket. This is resolved relative to this Terraform directory unless absolute."
  type        = string
  default     = "../../apps/frontend/dist"
}

variable "microvm_base_image_arn" {
  description = "Managed Lambda MicroVM base-image ARN. The default is the AL2023 image in aws partition."
  type        = string
  default     = ""
}

variable "microvm_base_image_version" {
  description = "Immutable managed base-image version returned by list-managed-microvm-image-versions."
  type        = string
}

variable "microvm_minimum_memory_mib" {
  description = "Minimum memory assigned to the ARM64 MicroVM image. Size it after measuring the selected GGUF model."
  type        = number
  default     = 4096

  validation {
    condition     = var.microvm_minimum_memory_mib >= 512
    error_message = "microvm_minimum_memory_mib must be at least 512 MiB."
  }
}

variable "microvm_hook_port" {
  description = "Container port that serves OpenJev and the Lambda MicroVM lifecycle-hook endpoints."
  type        = number
  default     = 8080
}

variable "lambda_runtime" {
  description = "Runtime for Controller and Streaming Proxy Lambda ZIP artifacts."
  type        = string
  default     = "nodejs22.x"
}

variable "lambda_architectures" {
  description = "Architecture for Controller and Streaming Proxy Lambda functions."
  type        = list(string)
  default     = ["arm64"]
}

variable "log_retention_in_days" {
  description = "Retention period for all CloudWatch Logs groups."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Additional tags applied to supported resources."
  type        = map(string)
  default     = {}
}
