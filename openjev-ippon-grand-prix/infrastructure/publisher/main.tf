locals {
  name_prefix          = "${var.project_name}-${var.environment}"
  generated_suffix     = random_id.suffix.hex
  artifact_bucket_name = var.artifact_bucket_name != "" ? var.artifact_bucket_name : "${local.name_prefix}-artifacts-${local.generated_suffix}"
  release_object_arn   = "${aws_s3_bucket.artifacts.arn}/${var.artifact_release_prefix}/*"
}

resource "random_id" "suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "artifacts" {
  bucket = local.artifact_bucket_name
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudwatch_log_group" "publisher" {
  name              = "/aws/codebuild/${local.name_prefix}-microvm-publisher"
  retention_in_days = var.log_retention_in_days
}

data "aws_iam_policy_document" "codebuild_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["codebuild.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "publisher" {
  name               = "${local.name_prefix}-microvm-publisher"
  assume_role_policy = data.aws_iam_policy_document.codebuild_assume_role.json
}

data "aws_iam_policy_document" "publisher" {
  statement {
    sid       = "WritePublisherLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.publisher.arn}:*"]
  }

  statement {
    sid       = "PublishAndVerifyContentAddressedArtifacts"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload"]
    resources = [local.release_object_arn]
  }
}

resource "aws_iam_role_policy" "publisher" {
  name   = "${local.name_prefix}-microvm-publisher"
  role   = aws_iam_role.publisher.id
  policy = data.aws_iam_policy_document.publisher.json
}

resource "aws_codebuild_project" "microvm_publisher" {
  name          = "${local.name_prefix}-microvm-publisher"
  description   = "Downloads, verifies, and publishes immutable OpenJev MicroVM artifacts."
  service_role  = aws_iam_role.publisher.arn
  build_timeout = 60

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_MEDIUM"
    image                       = "aws/codebuild/standard:7.0"
    type                        = "LINUX_CONTAINER"
    privileged_mode             = false
    image_pull_credentials_type = "CODEBUILD"

    environment_variable {
      name  = "ARTIFACT_BUCKET"
      value = aws_s3_bucket.artifacts.bucket
    }

    environment_variable {
      name  = "ARTIFACT_RELEASE_PREFIX"
      value = var.artifact_release_prefix
    }

    environment_variable {
      name  = "PUBLISHER_SOURCE_DIRECTORY"
      value = var.publisher_source_directory
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name  = aws_cloudwatch_log_group.publisher.name
      stream_name = "publisher"
      status      = "ENABLED"
    }
  }

  source {
    type            = var.publisher_source_type
    location        = var.publisher_source_location
    git_clone_depth = 1
    buildspec       = file("${path.module}/../../buildspec-microvm-publisher.yml")
  }

  tags = {
    Component = "microvm-artifact-publisher"
  }

  depends_on = [
    aws_iam_role_policy.publisher,
    aws_s3_bucket_public_access_block.artifacts,
    aws_s3_bucket_versioning.artifacts,
    aws_s3_bucket_server_side_encryption_configuration.artifacts,
  ]
}
