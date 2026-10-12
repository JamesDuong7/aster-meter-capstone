# Aster Meter

A small multi-tenant usage metering and billing engine for the FlyRank backend capstone. It meters a simulated generation request, enforces Free/Pro monthly quotas, calculates costs with integer microcents, and upgrades subscriptions through signed Stripe **test-mode** webhooks.

## Architecture

```text
Client --X-API-Key--> HTTP boundary (server.js)
                         | POST /generate
                         v
                    Meter logic (meter.js) --> Pricing (pricing.js)
                         | transaction: retry lookup -> quota check -> insert
                         v
                    SQLite usage_events (source of truth)
                         |
                         +--> GET /usage (tenant-scoped aggregate)

Stripe test Checkout --> signed webhook --> verify + deduplicate
                                           --> subscription mirror

Scheduler --> npm run rollup --> rebuildable monthly_rollups cache
```

## Requirements

Node.js 24 or newer. No npm install, Docker, paid service, or card is needed for the local core. Stripe test-mode Checkout requires a free Stripe account and Stripe CLI for local webhook forwarding. A real sandbox Checkout and signed webhook delivery were verified; see `EVIDENCE.md`.

## Run and seed

```sh
cp .env.example .env
npm run seed
npm run start
```

The seed command prints two **local demo** API keys. They are fixed for reproducible evaluation and must not be used for real customers. The database is created from `migrations/001_init.sql` on first run. `DB_PATH` can point to any writable SQLite file.

```sh
curl -s http://localhost:3000/health
curl -s -X POST http://localhost:3000/generate \
  -H 'X-API-Key: demo_orbit_key_2026_local_only' \
  -H 'Idempotency-Key: example-request-001' \
  -H 'Content-Type: application/json' \
  -d '{"input_tokens":100,"cached_input_tokens":20,"output_tokens":50,"reasoning_tokens":10}'
curl -s -H 'X-API-Key: demo_orbit_key_2026_local_only' http://localhost:3000/usage
npm test
```

For `/generate`, each request is one API call. Missing token fields mean zero. Reuse a key with identical quantities to replay the original response. Reuse it with changed quantities to get 409. Monthly quota periods use UTC months. At the exact limit the request succeeds; a request that would cross it gets 429 with `Retry-After`. An inactive or unpaid subscription gets 402. `X-API-Key` selects the tenant; client-supplied tenant IDs are ignored.

## Plans and pricing

| Plan | API calls / UTC month | AI tokens / UTC month |
| --- | ---: | ---: |
| Free | 1,000 | 100,000 |
| Pro | 100,000 | 10,000,000 |

Pinned demonstration prices: **$0.005 per API call**, **$2.00 per million fresh input tokens**, **$0.50 per million cached input tokens**, and **$8.00 per million output or reasoning tokens**. These are project constants, not a live provider price list. Cached input is a separate category and reasoning counts as output. Every event and monthly sum uses integer microcents; dollar strings are display values. No floating-point money is stored.

## Stripe test-mode setup

1. Create a recurring Pro product and price in Stripe **test mode**. Put its `price_...` ID in `.env` as `STRIPE_PRO_PRICE_ID` and a `sk_test_...` key as `STRIPE_SECRET_KEY`.
2. Run `stripe listen --forward-to localhost:3000/webhooks/stripe`. Put the printed `whsec_...` in `.env` as `STRIPE_WEBHOOK_SECRET`, then restart the server.
3. `POST /checkout` with a demo API key. Open the returned `checkoutUrl`, complete test Checkout using a Stripe test card, and inspect `GET /usage` after the webhook arrives.
4. To replay, use Stripe CLI event replay or resend a saved signed event. Duplicate event IDs are ignored. A forged or expired signature gets 400 before any database write.

The app only accepts `sk_test_` keys for Checkout. Secrets are environment-only and `.env` is git-ignored. The Checkout session attaches tenant metadata to the subscription. The subscription mirror changes only after verified webhooks. Stripe is the payment source of truth.

## Background job

`npm run rollup` rebuilds monthly summary rows off the request path. Schedule it daily with cron or your local scheduler. It retries three times with increasing delay and emits an `ALERT:` line plus nonzero exit code on final failure. `GET /usage` reads committed events directly, so billing data is correct even before this job runs.

## Limitations

- The core uses Node's built-in HTTP server and SQLite, with no external framework or Postgres. This keeps local setup one command, but differs from the suggested Express/FastAPI stack.
- The evaluator needs their own free Stripe test-mode credentials to repeat Checkout; no credentials are bundled. Automated tests and a real sandbox Checkout cover subscription synchronization.
- No multi-region coordination, invoices, proration, or overage billing. SQLite's single writer transaction protects a single deployed database file.
- Stripe event ordering uses event creation time and event ID to reject stale events. Events with identical timestamps can have uncertain actual order; reconciliation against Stripe would be the production follow-up.
