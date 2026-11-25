terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "ap-northeast-1"
}

variable "image_digest" {
  description = "Digest of the ARM64 image in this stack's ECR repository. Leave unset before the first build."
  type        = string
  default     = null

  validation {
    condition     = var.image_digest == null || can(regex("^sha256:[0-9a-f]{64}$", var.image_digest))
    error_message = "image_digest must be a sha256 digest."
  }
}

locals {
  name = "strands-decider-2b-on-lambda"
}

resource "aws_ecr_repository" "decider" {
  name                 = local.name
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true
}

resource "aws_ecr_repository_policy" "lambda" {
  repository = aws_ecr_repository.decider.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "LambdaECRImageRetrievalPolicy"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
    }]
  })
}

resource "aws_cloudwatch_log_group" "build" {
  name              = "/aws/codebuild/${local.name}"
  retention_in_days = 14
}

resource "aws_iam_role" "build" {
  name_prefix = "${local.name}-build-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "codebuild.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "build" {
  role = aws_iam_role.build.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
        ]
        Resource = aws_ecr_repository.decider.arn
      },
      {
        Effect   = "Allow"
        Action   = "logs:CreateLogGroup"
        Resource = aws_cloudwatch_log_group.build.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.build.arn}:log-stream:*"
      }
    ]
  })
}

resource "aws_codebuild_project" "decider" {
  name          = local.name
  service_role  = aws_iam_role.build.arn
  build_timeout = 60

  artifacts {
    type = "NO_ARTIFACTS"
  }

  source {
    type      = "NO_SOURCE"
    buildspec = file("${path.module}/buildspec.yml")
  }

  environment {
    type                        = "ARM_CONTAINER"
    image                       = "aws/codebuild/amazonlinux-aarch64-standard:3.0"
    compute_type                = "BUILD_GENERAL1_LARGE"
    image_pull_credentials_type = "CODEBUILD"
    privileged_mode             = true

    environment_variable {
      name  = "ECR_REPOSITORY_URI"
      value = aws_ecr_repository.decider.repository_url
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.build.name
    }
  }

  depends_on = [aws_iam_role_policy.build]
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.name}"
  retention_in_days = 14
}

resource "aws_iam_role" "lambda" {
  name_prefix = "${local.name}-lambda-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "lambda" {
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.lambda.arn}:log-stream:*"
    }]
  })
}

resource "aws_lambda_function" "decider" {
  count = var.image_digest == null ? 0 : 1

  function_name = local.name
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.decider.repository_url}@${var.image_digest}"
  architectures = ["arm64"]
  memory_size   = 10240
  timeout       = 900
  role          = aws_iam_role.lambda.arn

  environment {
    variables = {
      DECIDER_MAX_REQUEST_TOKENS = "24576"
    }
  }

  depends_on = [aws_ecr_repository_policy.lambda, aws_iam_role_policy.lambda]
}

resource "aws_lambda_function_url" "decider" {
  count = var.image_digest == null ? 0 : 1

  function_name      = aws_lambda_function.decider[0].function_name
  authorization_type = "AWS_IAM"
}

output "aws_region" {
  value = var.aws_region
}

output "build_project_name" {
  value = aws_codebuild_project.decider.name
}

output "repository_name" {
  value = aws_ecr_repository.decider.name
}

output "function_name" {
  value = one(aws_lambda_function.decider[*].function_name)
}

output "function_url" {
  value = one(aws_lambda_function_url.decider[*].function_url)
}
