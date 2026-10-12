# Aster Meter: one-page design

## Problem

A multi-tenant SaaS needs to accept billable actions exactly once, refuse actions over monthly quotas, show exact usage costs, and mirror Stripe test-mode subscription state.

## Data model

`tenants` stores organizations and hashed API keys. `plans` pins Free and Pro quotas. `subscriptions` records each tenant's current plan, status, Stripe IDs, and newest applied event. `usage_events` is the source of truth for metering; `(tenant_id, idempotency_key)` is unique. `stripe_events` deduplicates webhooks. `monthly_rollups` is a rebuildable background-job cache. Migration SQL includes foreign keys and a `(tenant_id, month)` usage index.

## API surface

- `POST /generate`: one simulated billable call; `X-API-Key`, `Idempotency-Key`, and JSON token quantities required. A repeated key and same quantities returns the original JSON; changed quantities return 409.
- `GET /usage?month=YYYY-MM`: tenant-scoped usage, limits, and cost.
- `POST /checkout`: creates a Stripe test-mode Pro subscription Checkout session.
- `POST /webhooks/stripe`: verifies the raw-body signature, deduplicates events, and mirrors subscription changes.
- `GET /health`: readiness check.

## Layers and correctness

`server.js` handles HTTP and validation, `meter.js` owns quota and idempotency decisions, `pricing.js` owns integer cost math, `stripe.js` owns payment sync, and `db.js` owns persistence and transactions. `BEGIN IMMEDIATE` serializes SQLite writers, so two concurrent requests cannot both pass the same quota or idempotency check. The committed usage event contains the exact response to replay. Monthly quotas use UTC calendar months and allow `used + requested == limit`; only `>` is blocked. Input, cached input, output, and reasoning tokens are tracked separately. Reasoning uses output pricing.

## Non-goal

No real charging, invoices, proration, overages, or model calls. Stripe test mode only. `GET /usage` computes from committed events so a delayed rollup job cannot show stale billing truth.
