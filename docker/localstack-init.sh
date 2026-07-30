#!/bin/bash
set -e

echo "Initializing LocalStack resources..."

# Create DynamoDB tables
awslocal dynamodb create-table --table-name kiro-scheduler-users \
  --attribute-definitions AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

awslocal dynamodb create-table --table-name kiro-scheduler-jobs \
  --attribute-definitions AttributeName=userId,AttributeType=S AttributeName=jobId,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH AttributeName=jobId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

awslocal dynamodb create-table --table-name kiro-scheduler-agents \
  --attribute-definitions AttributeName=userId,AttributeType=S AttributeName=agentId,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH AttributeName=agentId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

awslocal dynamodb create-table --table-name kiro-scheduler-skills \
  --attribute-definitions AttributeName=userId,AttributeType=S AttributeName=skillId,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH AttributeName=skillId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

awslocal dynamodb create-table --table-name kiro-scheduler-mcp-servers \
  --attribute-definitions AttributeName=userId,AttributeType=S AttributeName=mcpServerId,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH AttributeName=mcpServerId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

awslocal dynamodb create-table --table-name kiro-scheduler-executions \
  --attribute-definitions AttributeName=jobId,AttributeType=S AttributeName=executionId,AttributeType=S AttributeName=userId,AttributeType=S AttributeName=startTime,AttributeType=S \
  --key-schema AttributeName=jobId,KeyType=HASH AttributeName=executionId,KeyType=RANGE \
  --global-secondary-indexes '[{"IndexName":"userId-startTime-index","KeySchema":[{"AttributeName":"userId","KeyType":"HASH"},{"AttributeName":"startTime","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
  --billing-mode PAY_PER_REQUEST

# Create S3 bucket
awslocal s3 mb s3://kiro-scheduler-outputs

# Create SNS topic
awslocal sns create-topic --name kiro-scheduler-notifications

echo "LocalStack initialization complete!"
