#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
REGION="${AWS_REGION:-us-east-1}"

echo "═══════════════════════════════════════════════════════════"
echo "  Kiro Job Scheduler — Terraform Deployment"
echo "═══════════════════════════════════════════════════════════"

# ─── Step 1: Build the project ────────────────────────────────────────────────
echo ""
echo "▶ Step 1: Building project..."
cd "$PROJECT_ROOT"
pnpm install --frozen-lockfile
pnpm build

# ─── Step 2: Package Lambda functions ─────────────────────────────────────────
echo ""
echo "▶ Step 2: Packaging Lambda functions..."
cd "$PROJECT_ROOT/packages/api"
mkdir -p dist
# Bundle dispatcher with esbuild
npx esbuild src/handlers/dispatcher.ts --bundle --platform=node --target=node20 \
  --outfile=dist/handlers/dispatcher.js --external:@aws-sdk/*
cd dist && zip -r dispatcher.zip handlers/ && cd ..
echo "  ✓ dispatcher.zip created"

# Bundle CRUD API router with esbuild
npx esbuild src/router.ts --bundle --platform=node --target=node20 \
  --outfile=dist/index.js --external:@aws-sdk/*
cd dist && zip -r api.zip index.js && cd ..
echo "  ✓ api.zip created"

# Bundle notify-lark
npx esbuild src/handlers/notify-lark.ts --bundle --platform=node --target=node20 \
  --outfile=dist/notify-lark/index.js --external:@aws-sdk/*
cd dist/notify-lark && zip -r ../notify-lark.zip index.js && cd ../..
echo "  ✓ notify-lark.zip created"

# Bundle notify-telegram
npx esbuild src/handlers/notify-telegram.ts --bundle --platform=node --target=node20 \
  --outfile=dist/notify-telegram/index.js --external:@aws-sdk/*
cd dist/notify-telegram && zip -r ../notify-telegram.zip index.js && cd ../..
echo "  ✓ notify-telegram.zip created"

# ─── Step 3: Create Terraform state bucket (if not exists) ────────────────────
echo ""
echo "▶ Step 3: Ensuring Terraform state bucket exists..."
STATE_BUCKET="kiro-scheduler-tfstate"
if ! aws s3api head-bucket --bucket "$STATE_BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$STATE_BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" 2>/dev/null || \
  aws s3api create-bucket --bucket "$STATE_BUCKET" --region "$REGION"
  aws s3api put-bucket-versioning --bucket "$STATE_BUCKET" \
    --versioning-configuration Status=Enabled
  echo "  ✓ State bucket created: $STATE_BUCKET"
else
  echo "  ✓ State bucket exists: $STATE_BUCKET"
fi

# ─── Step 4: Terraform init & apply ──────────────────────────────────────────
echo ""
echo "▶ Step 4: Running Terraform..."
cd "$SCRIPT_DIR"

terraform init -input=false

echo ""
echo "▶ Planning infrastructure changes..."
terraform plan -out=tfplan

echo ""
read -p "▶ Apply changes? (yes/no): " CONFIRM
if [ "$CONFIRM" = "yes" ]; then
  terraform apply tfplan
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  ✓ Infrastructure deployed successfully!"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  terraform output
else
  echo "  ✗ Deployment cancelled."
  rm -f tfplan
  exit 0
fi

# ─── Step 5: Build and push Docker image ─────────────────────────────────────
echo ""
echo "▶ Step 5: Building and pushing Docker image..."
ECR_URL=$(terraform output -raw ecr_repository_url)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

cd "$PROJECT_ROOT/docker"
docker build --platform linux/amd64 -t kiro-job-runner .
docker tag kiro-job-runner "$ECR_URL:latest"
docker push "$ECR_URL:latest"
echo "  ✓ Image pushed to $ECR_URL:latest"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✓ Deployment complete!"
echo ""
echo "  ECR Image:    $ECR_URL:latest"
echo "  Cognito Pool: $(terraform output -raw cognito_user_pool_id)"
echo "  Cognito Client: $(terraform output -raw cognito_client_id)"
echo "═══════════════════════════════════════════════════════════"
