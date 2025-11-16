#!/bin/bash

# Guided Deployment Script for WhatsApp Bot
# Interactive deployment with SAM CLI guided mode

set -e

# Set AWS credentials from project folder
export AWS_SHARED_CREDENTIALS_FILE="$(pwd)/.aws/credentials"
export AWS_CONFIG_FILE="$(pwd)/.aws/config"

echo "🚀 Starting guided deployment..."
echo ""
echo "This will walk you through the deployment process."
echo ""

# Build first
echo "📦 Building SAM application..."
sam build
echo ""

# Deploy with guided mode
sam deploy --guided

echo ""
echo "✅ Deployment process complete!"

