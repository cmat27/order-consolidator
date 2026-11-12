#!/usr/bin/env bash
set -e

echo "=== 1. Running Unit Tests ==="
npx vitest run

echo "=== 2. Testing HMAC Webhook Security ==="
# Should return 401 Unauthorized without signature
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/webhooks/orders-create \
  -H "Content-Type: application/json" \
  -d '{"id": 12345}' | grep 401

echo "=== 3. Testing Mandatory GDPR Endpoints ==="
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/webhooks/customers-data-request | grep 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/webhooks/customers-redact | grep 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/webhooks/shop-redact | grep 200

echo "All verification checks passed!"
