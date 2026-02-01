#!/bin/bash

# Run local API on port 3001 (Node server — no Docker/SAM required).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "🔨 Installing Lambda dependencies..."
for d in src/auth-api src/payment-api src/dashboard-api src/inbound-webhook; do
  if [ -f "$d/package.json" ]; then
    echo "  → $d"
    (cd "$d" && npm install)
  fi
done
echo ""

echo "🚀 Starting local API on port 3001 (no Docker)..."
echo ""
echo "📍 Base URL: http://localhost:3001"
echo "📍 Auth:     http://localhost:3001/auth/otp/request"
echo "📍 Payment:  http://localhost:3001/payment/orders"
echo "📍 Webhook:  http://localhost:3001/webhook/inbound"
echo ""
echo "Press Ctrl+C to stop"
echo ""

exec node scripts/local-server.js
