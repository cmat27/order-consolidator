# Shopify Order Consolidator Micro-SaaS

An automated, headless Shopify Admin Micro-SaaS built with **Next.js App Router (TypeScript)**, **Shopify Polaris**, **Supabase (PostgreSQL)**, **Upstash QStash**, and the **Shopify GraphQL Admin API**.

It detects duplicate unfulfilled customer orders placed within a configurable debounce window, consolidates line items onto the primary order, cancels the redundant order, and automatically refunds excess shipping fees.

---

## Features & Architecture

- **Headless / Admin-Only Footprint**: Zero storefront Liquid or script tags. Embedded inside Shopify Admin using `@shopify/polaris`.
- **HMAC-SHA256 Webhook Security**: Timing-safe signature verification (`X-Shopify-Hmac-Sha256`) on incoming Shopify webhooks.
- **Delayed Debounce Queue (Upstash QStash)**: Deduplicated delayed jobs (`consolidate-<shop>-<orderId>`) wait for the merchant's configured merge window (`1h`, `2h`, `6h`, `12h`, `24h`) before evaluating candidate orders.
- **Address Normalization Engine**: Standardizes street suffixes, apartment/suite prefixes, casing, punctuation, and ZIP+4 codes to accurately match orders going to the same destination.
- **Automated GraphQL Order Consolidation**:
  1. Begins order edit (`orderEditBegin`) on the primary order.
  2. Adds variants (`orderEditAddVariant`) from the duplicate order.
  3. Commits edits (`orderEditCommit`) with an audit staff note.
  4. Cancels and restocks the duplicate order (`orderCancel` with reason `CUSTOMER`).
  5. Refunds excess shipping (`refundCreate`) when auto-refund is enabled.
- **Managed Recurring Billing**: `$19/month` plan with a 14-day free trial via `appSubscriptionCreate`.
- **Mandatory GDPR Webhooks**: Compliant endpoints for `customers/data_request`, `customers/redact`, and `shop/redact`.

---

## Project Structure

```text
order-consolidator/
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── verify.sh
├── local/                                      # Git-ignored local runbooks & smoke tests
│   ├── SMOKE_TEST_SCENARIOS.md                 # End-to-end & manual smoke test scenarios
│   └── GITHUB_ACTIONS_DEPLOYMENT.md            # GitHub Actions CI/CD deployment guide
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql              # PostgreSQL schema & RLS policies
├── lib/
│   ├── env.ts                                  # Zod environment variable validation
│   ├── supabase.ts                             # Authenticated Supabase service-role client
│   ├── shopify.ts                              # Shopify GraphQL client & session lookup
│   ├── verify-webhook.ts                       # Timing-safe HMAC-SHA256 verification
│   ├── normalize-address.ts                    # Address standardization algorithm
│   └── order-matcher.ts                        # Order matching & GraphQL merge engine
├── app/
│   ├── layout.tsx                              # Root layout with Polaris styles
│   ├── page.tsx                                # Embedded Polaris admin dashboard & settings
│   └── api/
│       ├── auth/callback/route.ts              # Shopify OAuth token exchange handler
│       ├── billing/subscribe/route.ts          # Shopify AppSubscriptionCreate mutation
│       ├── webhooks/
│       │   ├── orders-create/route.ts          # Order creation webhook -> QStash queue
│       │   ├── customers-data-request/route.ts # Mandatory GDPR endpoint
│       │   ├── customers-redact/route.ts       # Mandatory GDPR endpoint
│       │   └── shop-redact/route.ts            # Mandatory GDPR endpoint
│       └── workers/
│           └── consolidate/route.ts            # QStash-triggered merge execution worker
└── tests/
    ├── normalize-address.test.ts
    ├── verify-webhook.test.ts
    └── order-matcher.test.ts
```

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local` and fill in your credentials:
```bash
cp .env.example .env.local
```

### 3. Apply Database Migration
Apply `supabase/migrations/001_initial_schema.sql` in your Supabase SQL Editor or via the Supabase CLI:
```bash
supabase db push
```

### 4. Run Development Server
```bash
npm run dev
```
Open `http://localhost:3000` to view the embedded Polaris Admin dashboard.

---

## Testing & Verification

Run the unit test suite with Vitest:
```bash
npm test
```

Run the full automated verification script (unit tests + HMAC webhook security + GDPR endpoint checks against a running server on port `3000`):
```bash
./verify.sh
```

For detailed manual and end-to-end smoke test procedures, see [`local/SMOKE_TEST_SCENARIOS.md`](./local/SMOKE_TEST_SCENARIOS.md).

---

## Deployment

For step-by-step instructions on deploying this application using **GitHub Actions** (CI testing, Supabase migrations, and Vercel production deployment), see [`local/GITHUB_ACTIONS_DEPLOYMENT.md`](./local/GITHUB_ACTIONS_DEPLOYMENT.md).
