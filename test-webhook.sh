#!/bin/bash

# Test script for WhatsApp Webhook
# Tests the deployed webhook endpoint

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get webhook URL from CloudFormation stack
echo -e "${YELLOW}📡 Getting webhook URL from AWS...${NC}"
WEBHOOK_URL=$(aws cloudformation describe-stacks \
  --stack-name whatsapp-bot-stack \
  --query "Stacks[0].Outputs[?OutputKey=='ApiGatewayUrl'].OutputValue" \
  --output text 2>/dev/null)

if [ -z "$WEBHOOK_URL" ]; then
  echo -e "${RED}❌ Could not get webhook URL. Is the stack deployed?${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Webhook URL: ${WEBHOOK_URL}${NC}"
echo ""

# Test 1: Gupshup JSON format (standard)
echo -e "${YELLOW}🧪 Test 1: Gupshup JSON Format (Standard)${NC}"
echo ""

JSON_PAYLOAD='{
  "app": "TestApp",
  "timestamp": '$(date +%s000)',
  "version": 2,
  "type": "message",
  "payload": {
    "id": "test-message-'$(date +%s)'",
    "source": "919999999999",
    "type": "text",
    "payload": {
      "text": "Hello, this is a test message"
    },
    "sender": {
      "phone": "919999999999",
      "name": "Test User",
      "country_code": "91",
      "dial_code": "9999999999"
    }
  }
}'

echo "Request:"
echo "$JSON_PAYLOAD" | jq '.' 2>/dev/null || echo "$JSON_PAYLOAD"
echo ""
echo "Response:"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "User-Agent: Gupshup/1.0" \
  -d "$JSON_PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')

if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✅ Success! HTTP $HTTP_CODE${NC}"
  echo "Body: $BODY"
else
  echo -e "${RED}❌ Failed! HTTP $HTTP_CODE${NC}"
  echo "Body: $BODY"
fi

echo ""
echo "---"
echo ""

# Test 2: URL-encoded format (legacy)
echo -e "${YELLOW}🧪 Test 2: URL-encoded Format (Legacy)${NC}"
echo ""

URL_ENCODED="waNumber=917834811114&mobile=919999999999&timestamp=$(date +%s000)&name=Test+User&type=text&text=Hello+from+URL+encoded+format"

echo "Request: $URL_ENCODED"
echo ""
echo "Response:"
RESPONSE2=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "User-Agent: Gupshup/1.0" \
  -d "$URL_ENCODED")

HTTP_CODE2=$(echo "$RESPONSE2" | grep "HTTP_CODE" | cut -d: -f2)
BODY2=$(echo "$RESPONSE2" | sed '/HTTP_CODE/d')

if [ "$HTTP_CODE2" = "200" ]; then
  echo -e "${GREEN}✅ Success! HTTP $HTTP_CODE2${NC}"
  echo "Body: $BODY2"
else
  echo -e "${RED}❌ Failed! HTTP $HTTP_CODE2${NC}"
  echo "Body: $BODY2"
fi

echo ""
echo "---"
echo ""

# Test 3: Invalid payload
echo -e "${YELLOW}🧪 Test 3: Invalid Payload (Should return 400)${NC}"
echo ""

INVALID_PAYLOAD='{"invalid": "payload"}'

echo "Request: $INVALID_PAYLOAD"
echo ""
echo "Response:"
RESPONSE3=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "User-Agent: Gupshup/1.0" \
  -d "$INVALID_PAYLOAD")

HTTP_CODE3=$(echo "$RESPONSE3" | grep "HTTP_CODE" | cut -d: -f2)
BODY3=$(echo "$RESPONSE3" | sed '/HTTP_CODE/d')

if [ "$HTTP_CODE3" = "400" ]; then
  echo -e "${GREEN}✅ Correctly rejected! HTTP $HTTP_CODE3${NC}"
else
  echo -e "${YELLOW}⚠️  Unexpected response: HTTP $HTTP_CODE3${NC}"
fi
echo "Body: $BODY3"

echo ""
echo -e "${GREEN}✅ Testing complete!${NC}"
echo ""
echo "View logs with:"
echo "  sam logs -n GupshupInboundWebhook --stack-name whatsapp-bot-stack --tail"
