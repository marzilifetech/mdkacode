#!/bin/bash


export AWS_SHARED_CREDENTIALS_FILE="$(pwd)/.aws/credentials"
export AWS_CONFIG_FILE="$(pwd)/.aws/config"

echo "Using AWS credentials from: $AWS_SHARED_CREDENTIALS_FILE"
echo ""

echo "Building SAM application..."
sam build

echo ""
echo "Testing Text Message (with real AWS services)..."
sam local invoke GupshupInboundWebhook --event events/test-text-message.json

echo ""
echo "Testing Image Message (with real AWS services)..."
sam local invoke GupshupInboundWebhook --event events/test-image-message.json

echo ""
echo "Testing Sticker Message (with real AWS services)..."
sam local invoke GupshupInboundWebhook --event events/test-sticker-message.json

echo ""
echo "Testing Invalid Payload (should return 400)..."
sam local invoke GupshupInboundWebhook --event events/test-invalid-payload.json

