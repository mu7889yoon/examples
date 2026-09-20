data "aws_partition" "current" {}

data "aws_caller_identity" "current" {}

locals {
  name_prefix            = "${var.project_name}-${var.environment}"
  generated_suffix       = random_id.suffix.hex
  frontend_bucket_name   = var.frontend_bucket_name != "" ? var.frontend_bucket_name : "${local.name_prefix}-frontend-${local.generated_suffix}"
  openrouter_secret_name = var.openrouter_api_key_secret_name != "" ? var.openrouter_api_key_secret_name : "${local.name_prefix}/openrouter/api-key"
  microvm_image_name     = substr(replace("${local.name_prefix}-${local.generated_suffix}", "/[^A-Za-z0-9-_]/", "-"), 0, 64)
  base_image_arn         = var.microvm_base_image_arn != "" ? var.microvm_base_image_arn : "arn:${data.aws_partition.current.partition}:lambda:${var.aws_region}:aws:microvm-image:al2023-1"
  microvm_artifact_uri   = "s3://${data.aws_s3_bucket.artifacts.bucket}/${data.aws_s3_object.microvm.key}"
  microvm_image_log_arn  = "${aws_cloudwatch_log_group.microvm.arn}:*"
  # Vite copies a local development placeholder for this file. The separately
  # managed object below must own the production version with the API URL.
  frontend_dist_files = setsubtract(
    fileset(var.frontend_dist_path, "**"),
    toset(["openjev-runtime-config.js"]),
  )
  frontend_content_types = {
    css  = "text/css; charset=utf-8"
    html = "text/html; charset=utf-8"
    ico  = "image/x-icon"
    jpeg = "image/jpeg"
    jpg  = "image/jpeg"
    js   = "application/javascript; charset=utf-8"
    json = "application/json; charset=utf-8"
    map  = "application/json; charset=utf-8"
    png  = "image/png"
    svg  = "image/svg+xml"
    txt  = "text/plain; charset=utf-8"
    wasm = "application/wasm"
    webp = "image/webp"
  }
}

resource "random_id" "suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "frontend" {
  bucket = local.frontend_bucket_name
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# `npm run build` creates a hashed Vite distribution. Upload every file as part
# of the Terraform apply so the CloudFront origin is usable immediately after a
# deployment, rather than requiring a separate manual `aws s3 sync`.
resource "aws_s3_object" "frontend_dist" {
  for_each = local.frontend_dist_files

  bucket = aws_s3_bucket.frontend.id
  key    = each.value
  source = "${var.frontend_dist_path}/${each.value}"
  etag   = filemd5("${var.frontend_dist_path}/${each.value}")

  content_type = lookup(
    local.frontend_content_types,
    try(regex("\\.([^.]+)$", each.value)[0], ""),
    "application/octet-stream",
  )
  # Vite hashes assets. HTML must never keep a stale asset manifest, while its
  # immutable assets can be cached safely by browsers and CloudFront.
  cache_control = each.value == "index.html" ? "no-cache, no-store, must-revalidate" : "public, max-age=31536000, immutable"
}

# The publisher Terraform root owns this private, versioned bucket. Application
# deployment may upload the two Lambda ZIPs, but it never writes the MicroVM
# artifact: CodeBuild publishes it under an immutable content-addressed key.
data "aws_s3_bucket" "artifacts" {
  bucket = var.artifact_bucket_name
}

data "aws_s3_object" "microvm" {
  bucket = data.aws_s3_bucket.artifacts.id
  key    = var.microvm_artifact_key
}

resource "aws_s3_object" "controller_lambda" {
  bucket = data.aws_s3_bucket.artifacts.id
  key    = var.controller_lambda_artifact_key
  source = var.controller_lambda_artifact_path
  etag   = filemd5(var.controller_lambda_artifact_path)
}

resource "aws_s3_object" "streaming_proxy_lambda" {
  bucket = data.aws_s3_bucket.artifacts.id
  key    = var.streaming_proxy_lambda_artifact_key
  source = var.streaming_proxy_lambda_artifact_path
  etag   = filemd5(var.streaming_proxy_lambda_artifact_path)
}

resource "aws_cloudwatch_log_group" "controller" {
  name              = "/aws/lambda/${local.name_prefix}-controller"
  retention_in_days = var.log_retention_in_days
}

resource "aws_cloudwatch_log_group" "streaming_proxy" {
  name              = "/aws/lambda/${local.name_prefix}-streaming-proxy"
  retention_in_days = var.log_retention_in_days
}

resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/${local.name_prefix}"
  retention_in_days = var.log_retention_in_days
}

resource "aws_cloudwatch_log_group" "microvm" {
  name              = "/aws/lambda/microvms/${local.microvm_image_name}"
  retention_in_days = var.log_retention_in_days
}

# The secret container is managed here, but its value is deliberately not
# represented in Terraform state. Populate it after apply with
# `aws secretsmanager put-secret-value` (or import an existing secret first).
resource "aws_secretsmanager_secret" "openrouter_api_key" {
  name                    = local.openrouter_secret_name
  description             = "OpenRouter API key for ${local.name_prefix}"
  recovery_window_in_days = 7
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "microvm_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "controller" {
  name               = "${local.name_prefix}-controller"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role" "streaming_proxy" {
  name               = "${local.name_prefix}-streaming-proxy"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role" "microvm_build" {
  name               = "${local.name_prefix}-microvm-build"
  assume_role_policy = data.aws_iam_policy_document.microvm_assume_role.json
}

resource "aws_iam_role" "microvm_runtime" {
  name               = "${local.name_prefix}-microvm-runtime"
  assume_role_policy = data.aws_iam_policy_document.microvm_assume_role.json
}

data "aws_iam_policy_document" "controller" {
  statement {
    sid    = "WriteFunctionLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.controller.arn}:*"]
  }

  statement {
    sid       = "ManageSessions"
    effect    = "Allow"
    actions   = ["dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.sessions.arn]
  }

  statement {
    sid       = "RunSelectedImage"
    effect    = "Allow"
    actions   = ["lambda:RunMicrovm"]
    resources = [aws_cloudformation_stack.microvm_image.outputs["ImageArn"]]
  }

  # Lambda MicroVM instance actions do not support instance-level resource ARNs.
  # These actions therefore require the account-wide resource wildcard.
  statement {
    sid    = "InspectAndTerminateMicrovms"
    effect = "Allow"
    actions = [
      "lambda:GetMicrovm",
      "lambda:TerminateMicrovm",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "PassOnlyRuntimeRole"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.microvm_runtime.arn]
  }

  # RunMicrovm attaches AWS-managed ingress and egress connectors to the
  # transient MicroVM. Restrict this pass permission to those two connectors.
  statement {
    sid     = "PassManagedMicrovmNetworkConnectors"
    effect  = "Allow"
    actions = ["lambda:PassNetworkConnector"]
    resources = [
      "arn:${data.aws_partition.current.partition}:lambda:${var.aws_region}:aws:network-connector:aws-network-connector:HTTP_INGRESS",
      "arn:${data.aws_partition.current.partition}:lambda:${var.aws_region}:aws:network-connector:aws-network-connector:INTERNET_EGRESS",
    ]
  }
}

data "aws_iam_policy_document" "streaming_proxy" {
  statement {
    sid    = "WriteFunctionLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.streaming_proxy.arn}:*"]
  }

  statement {
    sid       = "ReadSession"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.sessions.arn]
  }

  statement {
    sid       = "ReadOpenRouterApiKey"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.openrouter_api_key.arn]
  }

  # MicroVM instance actions do not support instance-level resource ARNs.
  statement {
    sid       = "InspectAndCreateMicrovmAuthToken"
    effect    = "Allow"
    actions   = ["lambda:CreateMicrovmAuthToken", "lambda:GetMicrovm"]
    resources = ["*"]
  }
}

data "aws_iam_policy_document" "microvm_build" {
  statement {
    sid       = "ReadOnlyThisRuntimeArtifact"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${data.aws_s3_bucket.artifacts.arn}/${var.microvm_artifact_key}"]
  }

  statement {
    sid    = "CreateMicrovmBuildLogGroup"
    effect = "Allow"
    # CloudWatch does not support resource-level permissions for CreateLogGroup.
    actions   = ["logs:CreateLogGroup"]
    resources = ["*"]
  }

  statement {
    sid       = "WriteMicrovmBuildLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [local.microvm_image_log_arn]
  }
}

data "aws_iam_policy_document" "microvm_runtime" {
  statement {
    sid    = "WriteMicrovmRuntimeLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = [local.microvm_image_log_arn]
  }
}

resource "aws_iam_role_policy" "controller" {
  name   = "${local.name_prefix}-controller"
  role   = aws_iam_role.controller.id
  policy = data.aws_iam_policy_document.controller.json
}

resource "aws_iam_role_policy" "streaming_proxy" {
  name   = "${local.name_prefix}-streaming-proxy"
  role   = aws_iam_role.streaming_proxy.id
  policy = data.aws_iam_policy_document.streaming_proxy.json
}

resource "aws_iam_role_policy" "microvm_build" {
  name   = "${local.name_prefix}-microvm-build"
  role   = aws_iam_role.microvm_build.id
  policy = data.aws_iam_policy_document.microvm_build.json
}

resource "aws_iam_role_policy" "microvm_runtime" {
  name   = "${local.name_prefix}-microvm-runtime"
  role   = aws_iam_role.microvm_runtime.id
  policy = data.aws_iam_policy_document.microvm_runtime.json
}

resource "aws_dynamodb_table" "sessions" {
  name         = "${local.name_prefix}-sessions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "sessionId"

  attribute {
    name = "sessionId"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }
}

resource "aws_cloudformation_stack" "microvm_image" {
  name          = "${local.name_prefix}-microvm-image"
  template_body = file("${path.module}/microvm-image.yaml")

  parameters = {
    ArtifactUri        = local.microvm_artifact_uri
    BaseImageArn       = local.base_image_arn
    BaseImageVersion   = var.microvm_base_image_version
    BuildRoleArn       = aws_iam_role.microvm_build.arn
    ImageName          = local.microvm_image_name
    LogGroupName       = aws_cloudwatch_log_group.microvm.name
    MinimumMemoryInMiB = tostring(var.microvm_minimum_memory_mib)
    RuntimeHookPort    = tostring(var.microvm_hook_port)
  }

  capabilities = ["CAPABILITY_NAMED_IAM"]

  depends_on = [
    aws_iam_role_policy.microvm_build,
    aws_cloudwatch_log_group.microvm,
  ]
}

resource "aws_lambda_function" "controller" {
  function_name = "${local.name_prefix}-controller"
  role          = aws_iam_role.controller.arn
  runtime       = var.lambda_runtime
  handler       = "index.handler"
  architectures = var.lambda_architectures
  timeout       = 29
  memory_size   = 512

  s3_bucket        = data.aws_s3_bucket.artifacts.id
  s3_key           = aws_s3_object.controller_lambda.key
  source_code_hash = filebase64sha256(var.controller_lambda_artifact_path)

  environment {
    variables = {
      MICROVM_IMAGE_IDENTIFIER    = aws_cloudformation_stack.microvm_image.outputs["ImageArn"]
      MICROVM_RUNTIME_ROLE_ARN    = aws_iam_role.microvm_runtime.arn
      JUDGING_PROVIDER            = var.judging_provider
      LAUGH_PROBABILITY_THRESHOLD = tostring(var.laugh_probability_threshold)
      OPENROUTER_MODEL            = var.openrouter_model
      SESSION_TABLE_NAME          = aws_dynamodb_table.sessions.name
      SESSION_DURATION_SECONDS    = "3600"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.controller,
    aws_iam_role_policy.controller,
  ]
}

resource "aws_lambda_function" "streaming_proxy" {
  function_name = "${local.name_prefix}-streaming-proxy"
  role          = aws_iam_role.streaming_proxy.arn
  runtime       = var.lambda_runtime
  handler       = "index.handler"
  architectures = var.lambda_architectures
  # One request may score every Judge on a CPU-only MicroVM. Keep this aligned
  # with the API Gateway STREAM integration (900 seconds).
  timeout     = 900
  memory_size = 1024

  s3_bucket        = data.aws_s3_bucket.artifacts.id
  s3_key           = aws_s3_object.streaming_proxy_lambda.key
  source_code_hash = filebase64sha256(var.streaming_proxy_lambda_artifact_path)

  environment {
    variables = {
      MICROVM_IMAGE_IDENTIFIER      = aws_cloudformation_stack.microvm_image.outputs["ImageArn"]
      MICROVM_RUNTIME_ROLE_ARN      = aws_iam_role.microvm_runtime.arn
      JUDGING_PROVIDER              = var.judging_provider
      LAUGH_PROBABILITY_THRESHOLD   = tostring(var.laugh_probability_threshold)
      OPENROUTER_API_KEY_SECRET_ARN = aws_secretsmanager_secret.openrouter_api_key.arn
      OPENROUTER_MODEL              = var.openrouter_model
      SESSION_DURATION_SECONDS      = "3600"
      SESSION_TABLE_NAME            = aws_dynamodb_table.sessions.name
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.streaming_proxy,
    aws_iam_role_policy.streaming_proxy,
  ]
}

resource "aws_api_gateway_rest_api" "api" {
  name        = "${local.name_prefix}-api"
  description = "Public API for the OpenJev Ippon Grand Prix POC."

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_resource" "sessions" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "sessions"
}

resource "aws_api_gateway_resource" "session" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.sessions.id
  path_part   = "{sessionId}"
}

resource "aws_api_gateway_resource" "judge" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.session.id
  path_part   = "judge"
}

resource "aws_api_gateway_method" "create_session" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.sessions.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "get_session" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.session.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "delete_session" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.session.id
  http_method   = "DELETE"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "judge" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.judge.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "create_session" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.sessions.id
  http_method             = aws_api_gateway_method.create_session.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.controller.invoke_arn
}

resource "aws_api_gateway_integration" "get_session" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.session.id
  http_method             = aws_api_gateway_method.get_session.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.controller.invoke_arn
}

resource "aws_api_gateway_integration" "delete_session" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.session.id
  http_method             = aws_api_gateway_method.delete_session.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.controller.invoke_arn
}

resource "aws_api_gateway_integration" "judge" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.judge.id
  http_method             = aws_api_gateway_method.judge.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  # API Gateway invokes response-streaming Lambda integrations through the
  # dedicated 2021-11-15 response-streaming endpoint, not the standard
  # Lambda invoke ARN used by buffered proxy integrations.
  uri                    = "arn:${data.aws_partition.current.partition}:apigateway:${var.aws_region}:lambda:path/2021-11-15/functions/${aws_lambda_function.streaming_proxy.arn}/response-streaming-invocations"
  response_transfer_mode = "STREAM"
  timeout_milliseconds   = 900000
}

resource "aws_lambda_permission" "api_controller" {
  statement_id  = "AllowApiGatewayControllerInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.controller.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*/sessions*"
}

resource "aws_lambda_permission" "api_streaming_proxy" {
  statement_id  = "AllowApiGatewayStreamingProxyInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.streaming_proxy.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/POST/sessions/*/judge"
}

resource "aws_api_gateway_method" "sessions_options" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.sessions.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "session_options" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.session.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "judge_options" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.judge.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sessions_options" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.sessions.id
  http_method = aws_api_gateway_method.sessions_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 204}"
  }
}

resource "aws_api_gateway_integration" "session_options" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.session.id
  http_method = aws_api_gateway_method.session_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 204}"
  }
}

resource "aws_api_gateway_integration" "judge_options" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.judge.id
  http_method = aws_api_gateway_method.judge_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 204}"
  }
}

resource "aws_api_gateway_method_response" "sessions_options" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.sessions.id
  http_method = aws_api_gateway_method.sessions_options.http_method
  status_code = "204"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_method_response" "session_options" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.session.id
  http_method = aws_api_gateway_method.session_options.http_method
  status_code = "204"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_method_response" "judge_options" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.judge.id
  http_method = aws_api_gateway_method.judge_options.http_method
  status_code = "204"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "sessions_options" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.sessions.id
  http_method = aws_api_gateway_method.sessions_options.http_method
  status_code = aws_api_gateway_method_response.sessions_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

resource "aws_api_gateway_integration_response" "session_options" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.session.id
  http_method = aws_api_gateway_method.session_options.http_method
  status_code = aws_api_gateway_method_response.session_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'DELETE,GET,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

resource "aws_api_gateway_integration_response" "judge_options" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.judge.id
  http_method = aws_api_gateway_method.judge_options.http_method
  status_code = aws_api_gateway_method_response.judge_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

resource "aws_api_gateway_deployment" "api" {
  rest_api_id = aws_api_gateway_rest_api.api.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_integration.create_session.id,
      aws_api_gateway_integration.get_session.id,
      aws_api_gateway_integration.delete_session.id,
      aws_api_gateway_integration.judge.id,
      aws_api_gateway_integration.sessions_options.id,
      aws_api_gateway_integration.session_options.id,
      aws_api_gateway_integration.judge_options.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "api" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  deployment_id = aws_api_gateway_deployment.api.id
  stage_name    = var.environment

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      requestId         = "$context.requestId"
      extendedRequestId = "$context.extendedRequestId"
      ip                = "$context.identity.sourceIp"
      requestTime       = "$context.requestTime"
      httpMethod        = "$context.httpMethod"
      resourcePath      = "$context.resourcePath"
      status            = "$context.status"
      responseLength    = "$context.responseLength"
    })
  }
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.name_prefix}-frontend"
  description                       = "CloudFront access control for the static frontend bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_200"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "frontend-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "frontend-s3"

    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# The frontend is static, but the REST API hostname is allocated by this
# Terraform stack. Publish it as a tiny non-cached script so `terraform apply`
# produces a working UI without rebuilding the Vite bundle after the API URL is
# known. It is deliberately loaded before the module entrypoint in index.html.
resource "aws_s3_object" "frontend_runtime_config" {
  bucket        = aws_s3_bucket.frontend.id
  key           = "openjev-runtime-config.js"
  content       = "window.__OPENJEV_CONFIG__ = ${jsonencode({ apiBaseUrl = aws_api_gateway_stage.api.invoke_url })};\n"
  content_type  = "application/javascript; charset=utf-8"
  cache_control = "no-cache, no-store, must-revalidate"
}

data "aws_iam_policy_document" "frontend_bucket" {
  statement {
    sid    = "AllowCloudFrontReadOnly"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.frontend.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.frontend]
}
