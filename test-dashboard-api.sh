#!/bin/bash

# Test script for Dashboard API
BASE_URL="https://jmv0oz53r4.execute-api.ap-south-1.amazonaws.com/prod"

echo "🧪 Testing Dashboard API"
echo "Base URL: $BASE_URL"
echo ""

# Test 1: Dashboard Stats
echo "Test 1: Dashboard Statistics"
curl -s "$BASE_URL/dashboard/stats" | jq '.' || curl -s "$BASE_URL/dashboard/stats"
echo -e "\n"

# Test 2: Get Users
echo "Test 2: Get Users (limit 5)"
curl -s "$BASE_URL/dashboard/users?limit=5" | jq '.' || curl -s "$BASE_URL/dashboard/users?limit=5"
echo -e "\n"

# Test 3: Get Conversations
echo "Test 3: Get Conversations (limit 5)"
curl -s "$BASE_URL/dashboard/conversations?limit=5" | jq '.' || curl -s "$BASE_URL/dashboard/conversations?limit=5"
echo -e "\n"

# Test 4: Get Messages (if mobile exists)
echo "Test 4: Get Messages (sample mobile)"
curl -s "$BASE_URL/dashboard/messages?mobile=919777777778&limit=5" | jq '.' || curl -s "$BASE_URL/dashboard/messages?mobile=919777777778&limit=5"
echo -e "\n"

# Test 5: Get Escalations
echo "Test 5: Get Pending Escalations"
curl -s "$BASE_URL/dashboard/escalations?status=pending&limit=5" | jq '.' || curl -s "$BASE_URL/dashboard/escalations?status=pending&limit=5"
echo -e "\n"

echo "✅ Dashboard API tests complete!"

