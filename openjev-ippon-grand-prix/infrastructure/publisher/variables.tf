variable "aws_region" {
  description = "AWS region used for the artifact publisher."
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

variable "artifact_bucket_name" {
  description = "Optional globally unique artifact bucket name. Empty generates a unique name."
  type        = string
  default     = ""
}

variable "publisher_source_type" {
  description = "CodeBuild source type. Use GITHUB after authorizing this AWS account's CodeBuild GitHub connection."
  type        = string
  default     = "GITHUB"

  validation {
    condition     = contains(["GITHUB", "GITLAB", "BITBUCKET"], var.publisher_source_type)
    error_message = "publisher_source_type must be GITHUB, GITLAB, or BITBUCKET."
  }
}

variable "publisher_source_location" {
  description = "HTTPS repository URL CodeBuild clones to publish a release."
  type        = string

  validation {
    condition     = can(regex("^https://", var.publisher_source_location))
    error_message = "publisher_source_location must be an HTTPS repository URL."
  }
}

variable "publisher_source_version" {
  description = "Optional branch, tag, or commit passed when starting a build. This is informational; releases record CodeBuild's resolved commit."
  type        = string
  default     = "main"
}

variable "publisher_source_directory" {
  description = "Directory containing this project within the CodeBuild source checkout. Use . when the repository root is this project."
  type        = string
  default     = "."
}

variable "artifact_release_prefix" {
  description = "S3 prefix reserved for content-addressed MicroVM runtime releases."
  type        = string
  default     = "microvm/published"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9/_-]*[a-z0-9]$", var.artifact_release_prefix))
    error_message = "artifact_release_prefix must be a nonempty lowercase S3 key prefix without leading or trailing slashes."
  }
}

variable "log_retention_in_days" {
  description = "Retention period for CodeBuild logs."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Additional tags applied to supported resources."
  type        = map(string)
  default     = {}
}
