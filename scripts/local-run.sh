#!/bin/bash

# Local Run Script for WhatsApp Bot
# Starts a local API Gateway on port 3000

set -e

echo "🚀 Starting local API Gateway..."
echo ""
echo "📍 API will be available at: http://localhost:3000"
echo "📍 Webhook endpoint: http://localhost:3000/webhook/inbound"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Set AWS credentials from project folder
export AWS_SHARED_CREDENTIALS_FILE="$(pwd)/.aws/credentials"
export AWS_CONFIG_FILE="$(pwd)/.aws/config"

# Build if needed
if [ ! -d ".aws-sam/build" ]; then
  echo "📦 Building SAM application..."
  sam build
  echo ""
fi

# Start local API
sam local start-api \
  --port 3000 \
  --env-vars env.json \
  --warm-containers EAGER \
  --debug

