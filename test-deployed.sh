#!/bin/bash

# Test script for deployed WhatsApp Bot
# Tests the complete conversation flow

API_URL="https://jmv0oz53r4.execute-api.ap-south-1.amazonaws.com/prod/webhook/inbound"

echo "🧪 Testing Deployed WhatsApp Bot"
echo "API URL: $API_URL"
echo ""

# Test 1: Initial greeting (new user)
echo "Test 1: Initial Greeting (New User)"
curl -X POST "$API_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "waNumber=917834811114&mobile=919777777778&timestamp=$(date +%s)000&type=text&text=Hi" \
  -w "\nStatus: %{http_code}\n\n"

sleep 2

# Test 2: Respond Yes to greeting
echo "Test 2: Responding Yes to Greeting"
curl -X POST "$API_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "waNumber=917834811114&mobile=919777777778&timestamp=$(date +%s)000&type=text&text=Yes" \
  -w "\nStatus: %{http_code}\n\n"

sleep 2

# Test 3: Provide name
echo "Test 3: Providing Name"
curl -X POST "$API_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "waNumber=917834811114&mobile=919777777778&timestamp=$(date +%s)000&type=text&text=Sid Smith" \
  -w "\nStatus: %{http_code}\n\n"

sleep 2

# Test 4: Provide DOB
echo "Test 4: Providing DOB"
curl -X POST "$API_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "waNumber=917834811114&mobile=919777777778&timestamp=$(date +%s)000&type=text&text=15-06-1965" \
  -w "\nStatus: %{http_code}\n\n"

sleep 2

# Test 5: Provide city
echo "Test 5: Providing City"
curl -X POST "$API_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "waNumber=917834811114&mobile=919777777778&timestamp=$(date +%s)000&type=text&text=Mumbai" \
  -w "\nStatus: %{http_code}\n\n"

sleep 2

# Test 6: Select menu option (Holidays)
echo "Test 6: Selecting Menu Option (Holidays)"
curl -X POST "$API_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "waNumber=917834811114&mobile=919777777778&timestamp=$(date +%s)000&type=text&text=1" \
  -w "\nStatus: %{http_code}\n\n"

echo ""
echo "✅ Testing complete!"
echo ""
echo "Check CloudWatch Logs for:"
echo "  - GupshupInboundWebhook: /aws/lambda/GupshupInboundWebhook"
echo "  - ConversationProcessor: /aws/lambda/ConversationProcessor"
echo ""
echo "Check DynamoDB tables:"
echo "  - UserProfile"
echo "  - UserConversationState"
echo "  - WhatsAppMessageLog"
echo "  - HumanEscalation"

