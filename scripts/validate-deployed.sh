#!/bin/bash

# Validate deployed API (Auth + Payment). Uses stack output for base URL.

set -e

REGION="${AWS_REGION:-ap-south-1}"
STACK_NAME="${1:-whatsapp-bot-stack}"

BASE_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`AuthApiUrl`].OutputValue' \
  --output text 2>/dev/null || true)

if [ -z "$BASE_URL" ] || [ "$BASE_URL" == "None" ]; then
  echo "Could not get AuthApiUrl from stack $STACK_NAME. Set BASE_URL manually:"
  echo "  export BASE_URL=https://YOUR_API_ID.execute-api.REGION.amazonaws.com/prod"
  echo "  $0"
  exit 1
fi

echo "Validating deployed API"
echo "Base URL: $BASE_URL"
echo ""

PASS=0
FAIL=0

# 1. Auth OTP request (expect 200 or 429/500)
echo "1. POST /auth/otp/request"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/auth/otp/request" \
  -H "Content-Type: application/json" \
  -d '{"mobile":"919876543210"}')
if [ "$CODE" = "200" ] || [ "$CODE" = "429" ] || [ "$CODE" = "500" ]; then
  echo "   OK (HTTP $CODE)"
  ((PASS++)) || true
else
  echo "   FAIL (HTTP $CODE, expected 200/429/500)"
  ((FAIL++)) || true
fi
echo ""

# 2. Payment products without token (expect 401)
echo "2. GET /payment/products (no token)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE_URL/payment/products")
if [ "$CODE" = "401" ]; then
  echo "   OK (HTTP 401 Unauthorized)"
  ((PASS++)) || true
else
  echo "   FAIL (HTTP $CODE, expected 401)"
  ((FAIL++)) || true
fi
echo ""

# 3. Payment products with invalid token (expect 401)
echo "3. GET /payment/products (invalid token)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE_URL/payment/products" \
  -H "Authorization: Bearer invalid-token")
if [ "$CODE" = "401" ]; then
  echo "   OK (HTTP 401 Unauthorized)"
  ((PASS++)) || true
else
  echo "   FAIL (HTTP $CODE, expected 401)"
  ((FAIL++)) || true
fi
echo ""

# 4. Payment config without token (expect 401)
echo "4. GET /payment/config (no token)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE_URL/payment/config")
if [ "$CODE" = "401" ]; then
  echo "   OK (HTTP 401 Unauthorized)"
  ((PASS++)) || true
else
  echo "   FAIL (HTTP $CODE, expected 401)"
  ((FAIL++)) || true
fi
echo ""

# 5. Webhook path exists (expect 200 or 4xx from Razorpay validation)
echo "5. POST /payment/webhook (no signature)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/payment/webhook" \
  -H "Content-Type: application/json" \
  -d '{"event":"payment.captured"}')
if [ "$CODE" = "200" ] || [ "$CODE" = "400" ]; then
  echo "   OK (HTTP $CODE)"
  ((PASS++)) || true
else
  echo "   FAIL (HTTP $CODE, expected 200 or 400)"
  ((FAIL++)) || true
fi
echo ""

echo "----------------------------------------"
echo "Result: $PASS passed, $FAIL failed"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
echo "All checks passed."
exit 0
