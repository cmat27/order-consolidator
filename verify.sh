#!/usr/bin/env bash
set -e

echo "=== 1. Running Unit Tests ==="
npx vitest run

echo "=== 2. Testing HMAC Webhook Security (Should reject unsigned requests with 401) ==="
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/webhooks/orders-create \
  -H "Content-Type: application/json" \
  -d '{"id": 12345}' | grep 401

curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/webhooks/customers-data-request \
  -H "Content-Type: application/json" \
  -d '{}' | grep 401

curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/webhooks/customers-redact \
  -H "Content-Type: application/json" \
  -d '{}' | grep 401

curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/webhooks/shop-redact \
  -H "Content-Type: application/json" \
  -d '{}' | grep 401

echo "All verification checks passed!"
