#!/bin/bash
set -euo pipefail

# Required env vars: KIRO_API_KEY, PROMPT, JOB_CONFIG (base64-encoded JSON)
# Optional: JOB_ID, EXECUTION_ID, S3_OUTPUT_BUCKET, EXECUTIONS_TABLE, AWS_REGION, SNS_TOPIC_ARN

echo "[entrypoint] Starting Kiro job runner"

# Fetch KIRO_API_KEY from Secrets Manager if ARN is provided (never passed as plaintext)
if [ -n "${KIRO_API_KEY_SECRET_ARN:-}" ]; then
  echo "[entrypoint] Fetching KIRO_API_KEY from Secrets Manager..."
  export KIRO_API_KEY=$(aws secretsmanager get-secret-value \
    --secret-id "$KIRO_API_KEY_SECRET_ARN" \
    --query SecretString --output text \
    --region "${AWS_REGION:-us-east-1}")
fi

if [ -z "${KIRO_API_KEY:-}" ]; then
  echo "[entrypoint] ERROR: No KIRO_API_KEY available" >&2
  exit 1
fi

# Decode and write agent config + skills
if [ -n "${JOB_CONFIG_S3_KEY:-}" ] && [ -n "${JOB_CONFIG_S3_BUCKET:-}" ]; then
  echo "[entrypoint] Downloading job config from S3..."
  CONFIG_JSON=$(aws s3 cp "s3://${JOB_CONFIG_S3_BUCKET}/${JOB_CONFIG_S3_KEY}" - \
    --region "${AWS_REGION:-us-east-1}")
elif [ -n "${JOB_CONFIG:-}" ]; then
  CONFIG_JSON=$(echo "$JOB_CONFIG" | base64 -d)
fi

if [ -n "${CONFIG_JSON:-}" ]; then

  # Write agent config
  mkdir -p /tmp/.kiro/agents
  echo "$CONFIG_JSON" | jq -r '.agentConfig' > /tmp/.kiro/agents/job-agent.json

  # Write skill files
  SKILL_COUNT=$(echo "$CONFIG_JSON" | jq -r '.skills | length')
  if [ "$SKILL_COUNT" -gt 0 ]; then
    for i in $(seq 0 $((SKILL_COUNT - 1))); do
      SKILL_NAME=$(echo "$CONFIG_JSON" | jq -r ".skills[$i].name")
      SKILL_CONTENT=$(echo "$CONFIG_JSON" | jq -r ".skills[$i].content")
      SKILL_DIR="/tmp/.kiro/skills/${SKILL_NAME}"
      mkdir -p "$SKILL_DIR"
      echo "$SKILL_CONTENT" > "$SKILL_DIR/SKILL.md"
    done
  fi

  # Dynamically install MCP servers that aren't pre-installed
  MCP_COMMANDS=$(echo "$CONFIG_JSON" | jq -r '.agentConfig.mcpServers // {} | to_entries[].value.command // empty' 2>/dev/null)
  for cmd in $MCP_COMMANDS; do
    if ! command -v "$cmd" &>/dev/null; then
      echo "[entrypoint] Installing MCP server: $cmd"
      npm install -g "$cmd" 2>/dev/null || true
    fi
  done
fi

# Run Kiro CLI
if [ -n "${BUILTIN_AGENT:-}" ]; then
  echo "[entrypoint] Executing with built-in agent: $BUILTIN_AGENT"
  AGENT_FLAG="--agent $BUILTIN_AGENT"
else
  echo "[entrypoint] Executing with custom agent: job-agent"
  AGENT_FLAG="--agent job-agent"
fi

EXIT_CODE=0
kiro-cli chat --no-interactive --trust-all-tools $AGENT_FLAG "$PROMPT" \
  > /output/stdout.txt 2> /output/stderr.txt || EXIT_CODE=$?

echo "[entrypoint] Kiro CLI exited with code: $EXIT_CODE"

# Upload output to S3
if [ -n "${S3_OUTPUT_BUCKET:-}" ] && [ -n "${EXECUTION_ID:-}" ]; then
  S3_PREFIX="outputs/${USER_ID:-unknown}/${JOB_ID:-unknown}/${EXECUTION_ID}"
  aws s3 cp /output/stdout.txt "s3://${S3_OUTPUT_BUCKET}/${S3_PREFIX}/stdout.txt" > /dev/null 2>&1 || true
  aws s3 cp /output/stderr.txt "s3://${S3_OUTPUT_BUCKET}/${S3_PREFIX}/stderr.txt" > /dev/null 2>&1 || true
  echo "[entrypoint] Output uploaded to s3://${S3_OUTPUT_BUCKET}/${S3_PREFIX}/"
fi

# Update execution status in DynamoDB
if [ -n "${EXECUTIONS_TABLE:-}" ] && [ -n "${EXECUTION_ID:-}" ]; then
  STATUS="succeeded"
  [ "$EXIT_CODE" -ne 0 ] && STATUS="failed"
  END_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  S3_KEY="outputs/${USER_ID:-unknown}/${JOB_ID:-unknown}/${EXECUTION_ID}/stdout.txt"

  aws dynamodb update-item \
    --table-name "$EXECUTIONS_TABLE" \
    --key "{\"jobId\":{\"S\":\"${JOB_ID}\"},\"executionId\":{\"S\":\"${EXECUTION_ID}\"}}" \
    --update-expression "SET #s = :s, endTime = :e, outputS3Key = :k, exitCode = :c" \
    --expression-attribute-names '{"#s":"status"}' \
    --expression-attribute-values "{\":s\":{\"S\":\"${STATUS}\"},\":e\":{\"S\":\"${END_TIME}\"},\":k\":{\"S\":\"${S3_KEY}\"},\":c\":{\"N\":\"${EXIT_CODE}\"}}" \
    --region "${AWS_REGION:-us-east-1}" > /dev/null 2>&1 || true

  echo "[entrypoint] Execution status updated: $STATUS"

  # Publish SNS notification
  if [ -n "${SNS_TOPIC_ARN:-}" ]; then
    # Extract only Kiro's final response (after the last tool output, marked by "> ")
    # Strip ANSI codes first, then get content after the last separator/tool output
    CLEAN_OUTPUT=$(sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' /output/stdout.txt 2>/dev/null)
    # Get the final assistant response: everything after the last ">" prompt marker
    FINAL_RESPONSE=$(echo "$CLEAN_OUTPUT" | awk '/^> /{buf=""; capture=1; next} capture{buf=buf $0 "\n"} END{print buf}')
    # Fallback: if no "> " found, take the full output
    if [ -z "$FINAL_RESPONSE" ]; then
      FINAL_RESPONSE="$CLEAN_OUTPUT"
    fi
    # Truncate to 20000 chars from the beginning
    OUTPUT_PREVIEW=$(echo "$FINAL_RESPONSE" | head -c 20000 | jq -Rs . | sed 's/^"//;s/"$//')
    MSG=$(jq -n --arg jid "$JOB_ID" --arg eid "$EXECUTION_ID" --arg uid "${USER_ID:-}" \
      --arg status "$STATUS" --arg exit "$EXIT_CODE" --arg output "$OUTPUT_PREVIEW" \
      '{jobId:$jid, executionId:$eid, userId:$uid, status:$status, exitCode:($exit|tonumber), output:$output}')
    aws sns publish --topic-arn "$SNS_TOPIC_ARN" --message "$MSG" \
      --region "${AWS_REGION:-us-east-1}" > /dev/null 2>&1 || true
  fi
fi

exit $EXIT_CODE
