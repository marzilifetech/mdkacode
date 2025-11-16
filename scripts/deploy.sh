#!/bin/bash

# Deployment Script for WhatsApp Bot
# Deploys the SAM application to AWS

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Set AWS credentials from project folder
export AWS_SHARED_CREDENTIALS_FILE="$(pwd)/.aws/credentials"
export AWS_CONFIG_FILE="$(pwd)/.aws/config"

# Get region from config
REGION=$(aws configure get region)
STACK_NAME=${1:-whatsapp-bot-stack}

echo -e "${GREEN}🚀 Deploying WhatsApp Bot to AWS${NC}"
echo ""
echo -e "Region: ${YELLOW}${REGION}${NC}"
echo -e "Stack Name: ${YELLOW}${STACK_NAME}${NC}"
echo ""

# Validate template
echo -e "${YELLOW}📋 Validating SAM template...${NC}"
sam validate
echo ""

# Build
echo -e "${YELLOW}📦 Building SAM application...${NC}"
sam build
echo ""

# Check if stack exists
if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" &>/dev/null; then
  echo -e "${YELLOW}📝 Stack exists. Updating...${NC}"
  DEPLOY_MODE="update"
else
  echo -e "${YELLOW}🆕 Stack doesn't exist. Creating new stack...${NC}"
  DEPLOY_MODE="create"
fi
echo ""

# Deploy
echo -e "${GREEN}🚀 Deploying to AWS...${NC}"
if [ "$DEPLOY_MODE" == "create" ]; then
  sam deploy \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --capabilities CAPABILITY_IAM \
    --resolve-s3 \
    --no-confirm-changeset \
    --no-fail-on-empty-changeset
else
  sam deploy \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --capabilities CAPABILITY_IAM \
    --resolve-s3 \
    --no-confirm-changeset \
    --no-fail-on-empty-changeset
fi

echo ""
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""

# Get outputs
echo -e "${YELLOW}📊 Stack Outputs:${NC}"
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs' \
  --output table

echo ""
echo -e "${GREEN}🎉 Your WhatsApp Bot is live!${NC}"
echo ""
echo "Next steps:"
echo "1. Copy the ApiGatewayUrl from the outputs above"
echo "2. Configure it in your Gupshup dashboard"
echo "3. Test with: curl -X POST <ApiGatewayUrl> -H 'Content-Type: application/x-www-form-urlencoded' -d '...'"

