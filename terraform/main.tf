terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }

  backend "s3" {
    bucket = "kiro-scheduler-tfstate"
    key    = "infra/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.region
}

# ─── Variables ────────────────────────────────────────────────────────────────

variable "region" {
  default = "us-east-1"
}

variable "project" {
  default = "kiro-scheduler"
}

variable "environment" {
  default = "prod"
}

variable "allowed_email_domain" {
  description = "Email domain allowed for Cognito user registration (e.g. amazon.com)"
  default     = "amazon.com"
}

variable "existing_vpc_id" {
  description = "Use an existing VPC. Leave empty to create a new one."
  default     = ""
}

variable "existing_subnet_ids" {
  description = "Subnet IDs in the existing VPC (must have internet access). Required if existing_vpc_id is set."
  type        = list(string)
  default     = []
}

# ─── VPC (conditional: create new or use existing) ────────────────────────────

locals {
  create_vpc = var.existing_vpc_id == ""
  vpc_id     = local.create_vpc ? aws_vpc.main[0].id : var.existing_vpc_id
  subnet_ids = local.create_vpc ? [aws_subnet.public_a[0].id, aws_subnet.public_b[0].id] : var.existing_subnet_ids
}

resource "aws_vpc" "main" {
  count                = local.create_vpc ? 1 : 0
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = "${var.project}-vpc" }
}

resource "aws_internet_gateway" "main" {
  count  = local.create_vpc ? 1 : 0
  vpc_id = aws_vpc.main[0].id
  tags   = { Name = "${var.project}-igw" }
}

resource "aws_subnet" "public_a" {
  count                   = local.create_vpc ? 1 : 0
  vpc_id                  = aws_vpc.main[0].id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "${var.region}a"
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.project}-public-a" }
}

resource "aws_subnet" "public_b" {
  count                   = local.create_vpc ? 1 : 0
  vpc_id                  = aws_vpc.main[0].id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "${var.region}b"
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.project}-public-b" }
}

resource "aws_route_table" "public" {
  count  = local.create_vpc ? 1 : 0
  vpc_id = aws_vpc.main[0].id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main[0].id
  }
  tags = { Name = "${var.project}-public-rt" }
}

resource "aws_route_table_association" "public_a" {
  count          = local.create_vpc ? 1 : 0
  subnet_id      = aws_subnet.public_a[0].id
  route_table_id = aws_route_table.public[0].id
}

resource "aws_route_table_association" "public_b" {
  count          = local.create_vpc ? 1 : 0
  subnet_id      = aws_subnet.public_b[0].id
  route_table_id = aws_route_table.public[0].id
}

# ─── Security Group for ECS Tasks ─────────────────────────────────────────────

resource "aws_security_group" "ecs_tasks" {
  name        = "${var.project}-ecs-tasks"
  description = "Security group for Kiro job runner ECS tasks"
  vpc_id      = local.vpc_id

  # Allow outbound HTTPS (for AWS APIs, Kiro API, MCP servers)
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS outbound (AWS APIs, Kiro CLI, MCP servers)"
  }

  # Allow outbound DNS
  egress {
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "DNS resolution"
  }

  # No inbound rules - tasks don't accept incoming connections
  tags = { Name = "${var.project}-ecs-tasks" }
}

# ─── KMS Key ──────────────────────────────────────────────────────────────────

resource "aws_kms_key" "main" {
  description             = "${var.project} encryption key"
  deletion_window_in_days = 14
  enable_key_rotation     = true
}

resource "aws_kms_alias" "main" {
  name          = "alias/${var.project}"
  target_key_id = aws_kms_key.main.key_id
}

# ─── DynamoDB Tables ──────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "users" {
  name         = "${var.project}-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.main.arn
  }
}

resource "aws_dynamodb_table" "jobs" {
  name         = "${var.project}-jobs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "jobId"

  attribute {
    name = "userId"
    type = "S"
  }
  attribute {
    name = "jobId"
    type = "S"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.main.arn
  }
}

resource "aws_dynamodb_table" "agents" {
  name         = "${var.project}-agents"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "agentId"

  attribute {
    name = "userId"
    type = "S"
  }
  attribute {
    name = "agentId"
    type = "S"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.main.arn
  }
}

resource "aws_dynamodb_table" "skills" {
  name         = "${var.project}-skills"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "skillId"

  attribute {
    name = "userId"
    type = "S"
  }
  attribute {
    name = "skillId"
    type = "S"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.main.arn
  }
}

resource "aws_dynamodb_table" "mcp_servers" {
  name         = "${var.project}-mcp-servers"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "mcpServerId"

  attribute {
    name = "userId"
    type = "S"
  }
  attribute {
    name = "mcpServerId"
    type = "S"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.main.arn
  }
}

resource "aws_dynamodb_table" "executions" {
  name         = "${var.project}-executions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "jobId"
  range_key    = "executionId"

  attribute {
    name = "jobId"
    type = "S"
  }
  attribute {
    name = "executionId"
    type = "S"
  }
  attribute {
    name = "userId"
    type = "S"
  }
  attribute {
    name = "startTime"
    type = "S"
  }

  global_secondary_index {
    name            = "userId-startTime-index"
    hash_key        = "userId"
    range_key       = "startTime"
    projection_type = "ALL"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.main.arn
  }
}

# ─── S3 Bucket ────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "outputs" {
  bucket = "${var.project}-outputs-${data.aws_caller_identity.current.account_id}"
  tags   = { Name = "${var.project}-outputs" }
}

resource "aws_s3_bucket_versioning" "outputs" {
  bucket = aws_s3_bucket.outputs.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "outputs" {
  bucket = aws_s3_bucket.outputs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.main.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "outputs" {
  bucket = aws_s3_bucket.outputs.id
  rule {
    id     = "expire-90-days"
    status = "Enabled"
    filter {}
    expiration { days = 90 }
  }
}

resource "aws_s3_bucket_public_access_block" "outputs" {
  bucket                  = aws_s3_bucket.outputs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ─── ECR Repository ──────────────────────────────────────────────────────────

resource "aws_ecr_repository" "runner" {
  name                 = "kiro-job-runner"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "runner" {
  repository = aws_ecr_repository.runner.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      selection    = { tagStatus = "untagged", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

# ─── Cognito ──────────────────────────────────────────────────────────────────

resource "aws_cognito_user_pool" "main" {
  name = "${var.project}-users"

  auto_verified_attributes = ["email"]
  username_attributes      = ["email"]

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true
    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  lambda_config {
    pre_sign_up = aws_lambda_function.pre_signup.arn
  }
}

# Pre-signup Lambda: restrict to @amazon.com emails
resource "aws_lambda_function" "pre_signup" {
  function_name = "${var.project}-pre-signup"
  role          = aws_iam_role.pre_signup.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 5

  filename = "${path.module}/pre-signup.zip"

  source_code_hash = filebase64sha256("${path.module}/pre-signup.zip")

  environment {
    variables = {
      ALLOWED_EMAIL_DOMAIN = var.allowed_email_domain
    }
  }
}

resource "aws_iam_role" "pre_signup" {
  name = "${var.project}-pre-signup"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "pre_signup_basic" {
  role       = aws_iam_role.pre_signup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_permission" "cognito_pre_signup" {
  statement_id  = "AllowCognito"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pre_signup.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.project}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  explicit_auth_flows = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  generate_secret     = false
}

# ─── ECS Cluster ──────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = var.project
}

# ─── IAM Roles ────────────────────────────────────────────────────────────────

# ECS Task Execution Role (pulls images, reads secrets for KIRO_API_KEY)
resource "aws_iam_role" "ecs_execution" {
  name = "${var.project}-ecs-execution"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_base" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "read-kiro-secrets"
  role = aws_iam_role.ecs_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue", "secretsmanager:CreateSecret", "secretsmanager:PutSecretValue", "secretsmanager:DeleteSecret"]
      Resource = "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:kiro-scheduler/users/*"
    }]
  })
}

# ECS Task Role (what the container can do: S3 put, DynamoDB write, SNS publish)
resource "aws_iam_role" "ecs_task" {
  name = "${var.project}-ecs-task"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "ecs_task_permissions" {
  name = "task-permissions"
  role = aws_iam_role.ecs_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.outputs.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem", "dynamodb:PutItem"]
        Resource = aws_dynamodb_table.executions.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = aws_sns_topic.notifications.arn
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue", "secretsmanager:CreateSecret", "secretsmanager:PutSecretValue", "secretsmanager:DeleteSecret"]
        Resource = "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:kiro-scheduler/users/*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = aws_kms_key.main.arn
      }
    ]
  })
}

# Dispatcher Lambda Role
resource "aws_iam_role" "dispatcher" {
  name = "${var.project}-dispatcher"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "dispatcher_basic" {
  role       = aws_iam_role.dispatcher.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "dispatcher_permissions" {
  name = "dispatcher-permissions"
  role = aws_iam_role.dispatcher.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:BatchGetItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"]
        Resource = [
          aws_dynamodb_table.users.arn,
          aws_dynamodb_table.jobs.arn,
          aws_dynamodb_table.agents.arn,
          aws_dynamodb_table.skills.arn,
          aws_dynamodb_table.mcp_servers.arn,
          aws_dynamodb_table.executions.arn,
          "${aws_dynamodb_table.executions.arn}/index/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
        Resource = aws_kms_key.main.arn
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue", "secretsmanager:CreateSecret", "secretsmanager:PutSecretValue", "secretsmanager:DeleteSecret"]
        Resource = "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:kiro-scheduler/users/*"
      },
      {
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = aws_ecs_task_definition.runner.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.outputs.arn}/configs/*"
      },
      {
        Effect   = "Allow"
        Action   = ["scheduler:CreateSchedule", "scheduler:UpdateSchedule", "scheduler:DeleteSchedule", "scheduler:GetSchedule"]
        Resource = "arn:aws:scheduler:${var.region}:${data.aws_caller_identity.current.account_id}:schedule/default/kiro-job-*"
      },
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.dispatcher.arn
      },
      {
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [aws_iam_role.ecs_execution.arn, aws_iam_role.ecs_task.arn, aws_iam_role.scheduler.arn]
      }
    ]
  })
}

# EventBridge Scheduler Role
resource "aws_iam_role" "scheduler" {
  name = "${var.project}-scheduler"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "scheduler.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name = "invoke-dispatcher"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.dispatcher.arn
    }]
  })
}

# ─── ECS Task Definition ─────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/${var.project}"
  retention_in_days = 14
}

resource "aws_ecs_task_definition" "runner" {
  family                   = "kiro-job-runner"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  ephemeral_storage { size_in_gib = 30 }

  container_definitions = jsonencode([{
    name  = "runner"
    image = "${aws_ecr_repository.runner.repository_url}:latest"
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "kiro-job"
      }
    }
    environment = [
      { name = "S3_OUTPUT_BUCKET", value = aws_s3_bucket.outputs.id },
      { name = "EXECUTIONS_TABLE", value = aws_dynamodb_table.executions.name },
      { name = "AWS_REGION", value = var.region },
      { name = "SNS_TOPIC_ARN", value = aws_sns_topic.notifications.arn },
    ]
  }])
}

# ─── SNS Topic ────────────────────────────────────────────────────────────────

resource "aws_sns_topic" "notifications" {
  name = "${var.project}-notifications"
}

resource "aws_sns_topic_policy" "notifications" {
  arn = aws_sns_topic.notifications.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowOnlyEcsTaskPublish"
      Effect    = "Allow"
      Principal = { AWS = aws_iam_role.ecs_task.arn }
      Action    = "SNS:Publish"
      Resource  = aws_sns_topic.notifications.arn
    }]
  })
}

# ─── Lambda: Dispatcher ───────────────────────────────────────────────────────

resource "aws_lambda_function" "dispatcher" {
  function_name = "${var.project}-dispatcher"
  role          = aws_iam_role.dispatcher.arn
  handler       = "handlers/dispatcher.handler"
  runtime       = "nodejs20.x"
  timeout       = 60
  memory_size   = 256

  filename         = "${path.module}/../packages/api/dist/dispatcher.zip"
  source_code_hash = filebase64sha256("${path.module}/../packages/api/dist/dispatcher.zip")

  environment {
    variables = {
      JOBS_TABLE         = aws_dynamodb_table.jobs.name
      AGENTS_TABLE       = aws_dynamodb_table.agents.name
      SKILLS_TABLE       = aws_dynamodb_table.skills.name
      MCP_SERVERS_TABLE  = aws_dynamodb_table.mcp_servers.name
      EXECUTIONS_TABLE   = aws_dynamodb_table.executions.name
      CLUSTER_ARN        = aws_ecs_cluster.main.arn
      TASK_DEF_ARN       = aws_ecs_task_definition.runner.arn
      SUBNET_IDS         = join(",", local.subnet_ids)
      SECURITY_GROUP_IDS = aws_security_group.ecs_tasks.id
      S3_OUTPUT_BUCKET   = aws_s3_bucket.outputs.id
      SNS_TOPIC_ARN      = aws_sns_topic.notifications.arn
      AWS_ACCOUNT_ID     = data.aws_caller_identity.current.account_id
    }
  }
}

# ─── Lambda: CRUD API ─────────────────────────────────────────────────────────

resource "aws_lambda_function" "api" {
  function_name = "${var.project}-api"
  role          = aws_iam_role.dispatcher.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 30
  memory_size   = 256

  filename         = "${path.module}/../packages/api/dist/api.zip"
  source_code_hash = filebase64sha256("${path.module}/../packages/api/dist/api.zip")

  environment {
    variables = {
      USERS_TABLE           = aws_dynamodb_table.users.name
      JOBS_TABLE            = aws_dynamodb_table.jobs.name
      AGENTS_TABLE          = aws_dynamodb_table.agents.name
      SKILLS_TABLE          = aws_dynamodb_table.skills.name
      MCP_SERVERS_TABLE     = aws_dynamodb_table.mcp_servers.name
      EXECUTIONS_TABLE      = aws_dynamodb_table.executions.name
      S3_OUTPUT_BUCKET      = aws_s3_bucket.outputs.id
      DISPATCHER_LAMBDA_ARN = aws_lambda_function.dispatcher.arn
      SCHEDULER_ROLE_ARN    = aws_iam_role.scheduler.arn
      ALLOWED_ORIGIN        = "https://${aws_cloudfront_distribution.frontend.domain_name}"
    }
  }
}

# ─── Lambda: Notify Lark ──────────────────────────────────────────────────────

resource "aws_lambda_function" "notify_lark" {
  function_name = "${var.project}-notify-lark"
  role          = aws_iam_role.dispatcher.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 15
  memory_size   = 128

  filename         = "${path.module}/../packages/api/dist/notify-lark.zip"
  source_code_hash = filebase64sha256("${path.module}/../packages/api/dist/notify-lark.zip")

  environment {
    variables = {
      USERS_TABLE = aws_dynamodb_table.users.name
      JOBS_TABLE  = aws_dynamodb_table.jobs.name
    }
  }
}

resource "aws_lambda_permission" "sns_lark" {
  statement_id  = "AllowSNS"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.notify_lark.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.notifications.arn
}

resource "aws_sns_topic_subscription" "lark" {
  topic_arn = aws_sns_topic.notifications.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.notify_lark.arn
}

# ─── Lambda: Notify Telegram ─────────────────────────────────────────────────

resource "aws_lambda_function" "notify_telegram" {
  function_name = "${var.project}-notify-telegram"
  role          = aws_iam_role.dispatcher.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 15
  memory_size   = 128

  filename         = "${path.module}/../packages/api/dist/notify-telegram.zip"
  source_code_hash = filebase64sha256("${path.module}/../packages/api/dist/notify-telegram.zip")

  environment {
    variables = {
      USERS_TABLE = aws_dynamodb_table.users.name
      JOBS_TABLE  = aws_dynamodb_table.jobs.name
    }
  }
}

resource "aws_lambda_permission" "sns_telegram" {
  statement_id  = "AllowSNS"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.notify_telegram.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.notifications.arn
}

resource "aws_sns_topic_subscription" "telegram" {
  topic_arn = aws_sns_topic.notifications.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.notify_telegram.arn
}

# ─── Data Sources ─────────────────────────────────────────────────────────────

data "aws_caller_identity" "current" {}

# ─── API Gateway (Cognito-protected) ─────────────────────────────────────────

resource "aws_apigatewayv2_api" "main" {
  name          = "${var.project}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.main.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.web.id]
    issuer   = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 100
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gw.arn
    format          = "$context.requestId $context.authorizer.error $context.status $context.httpMethod $context.path"
  }
}

resource "aws_cloudwatch_log_group" "api_gw" {
  name              = "/aws/apigateway/${var.project}"
  retention_in_days = 14
}

# API Gateway Lambda integration
resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

# Catch-all route with Cognito auth
resource "aws_apigatewayv2_route" "api_default" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "$default"
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# OPTIONS preflight must not require auth
resource "aws_apigatewayv2_route" "options" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "OPTIONS /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_lambda_permission" "api_gw" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# ─── CloudFront + S3 Frontend ─────────────────────────────────────────────────

resource "aws_s3_bucket" "frontend" {
  bucket = "${var.project}-frontend-${data.aws_caller_identity.current.account_id}"
  tags   = { Name = "${var.project}-frontend" }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.project}-frontend-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CloudFront Function: rewrite URLs for Next.js static export
resource "aws_cloudfront_function" "url_rewrite" {
  name    = "kiro-scheduler-url-rewrite"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-EOF
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      // Don't rewrite _next assets, api, or files with extensions
      if (uri.startsWith('/_next/') || uri.startsWith('/api/') || uri.includes('.')) {
        return request;
      }
      // Append .html for clean URLs (e.g. /login -> /login.html)
      if (uri.endsWith('/')) {
        request.uri += 'index.html';
      } else {
        request.uri += '.html';
      }
      return request;
    }
  EOF
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "s3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  # API origin (proxied through CloudFront so API is not directly exposed)
  origin {
    domain_name = replace(aws_apigatewayv2_api.main.api_endpoint, "https://", "")
    origin_id   = "api"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # API routes go to API Gateway (path pattern /api/*)
  ordered_cache_behavior {
    path_pattern     = "/api/*"
    target_origin_id = "api"
    allowed_methods  = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods   = ["GET", "HEAD"]

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Content-Type"]
      cookies { forward = "none" }
    }

    viewer_protocol_policy = "https-only"
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0
  }

  # Default: serve frontend from S3
  default_cache_behavior {
    target_origin_id       = "s3-frontend"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    viewer_protocol_policy = "redirect-to-https"

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.url_rewrite.arn
    }

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000
  }

  # Return 404.html for missing pages (after URL rewrite adds .html)
  custom_error_response {
    error_code         = 403
    response_code      = 404
    response_page_path = "/404.html"
    error_caching_min_ttl = 0
  }
  custom_error_response {
    error_code         = 404
    response_code      = 404
    response_page_path = "/404.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# S3 bucket policy: only CloudFront can read
resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.frontend.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn } }
    }]
  })
}

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "vpc_id" { value = local.vpc_id }
output "subnet_ids" { value = local.subnet_ids }
output "ecs_cluster_arn" { value = aws_ecs_cluster.main.arn }
output "task_definition_arn" { value = aws_ecs_task_definition.runner.arn }
output "ecr_repository_url" { value = aws_ecr_repository.runner.repository_url }
output "s3_output_bucket" { value = aws_s3_bucket.outputs.id }
output "cognito_user_pool_id" { value = aws_cognito_user_pool.main.id }
output "cognito_client_id" { value = aws_cognito_user_pool_client.web.id }
output "dispatcher_lambda_arn" { value = aws_lambda_function.dispatcher.arn }
output "scheduler_role_arn" { value = aws_iam_role.scheduler.arn }
output "sns_topic_arn" { value = aws_sns_topic.notifications.arn }
output "api_endpoint" { value = aws_apigatewayv2_api.main.api_endpoint }
output "cloudfront_domain" { value = aws_cloudfront_distribution.frontend.domain_name }
output "frontend_bucket" { value = aws_s3_bucket.frontend.id }
