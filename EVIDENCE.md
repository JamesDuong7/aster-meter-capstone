# Evidence

Recorded 2026-10-11 (Pacific time). Commands were run in this repository. Local HTTP probes used demo databases outside the repository. A real Stripe sandbox Checkout and signed webhook delivery were completed in test mode. No customer details, API keys, or webhook secrets are included here.

`BUILDLOG.md` is intentionally absent per the project owner's instruction to ignore the brief's AI-use log rule. The brief also lists it as a machine-checked submission file, so the repository is not yet submission-complete under that rubric.

## Section 6 requirements

| Requirement | Proof | Status |
| --- | --- | --- |
| One event under retries | `retry mirrors first response and inserts one event; changed body conflicts` passed; local HTTP replay returned byte-identical JSON and `GET /usage` showed one API call. Unique `(tenant_id,idempotency_key)` constraint in migration. | Verified |
| Quota enforcement and status | `quota allows exact boundary and rejects one more with 429` and `inactive subscription returns 402` passed. | Verified |
| Monthly cost and token rules | `cached input is cheaper and reasoning is priced as output with exact integers` passed; `GET /usage` total shown below. | Verified |
| Checkout session against Stripe test mode | Stripe price API returned HTTP 200, `livemode=false`, `active=true`, `currency=usd`, `recurring=month`, `unitAmount=1000`. `POST /checkout` returned a `cs_test_` session; the hosted Sandbox page showed Aster Meter Pro for $10/month, and the test Checkout completed. | Verified live in test mode |
| Signed, deduplicated webhooks and plan sync | Stripe CLI forwarded `checkout.session.completed` and the app returned HTTP 200. `GET /usage` changed Free → Pro. The same real event replayed twice returned `duplicate:true`; database count stayed 1. A forged signature returned HTTP 400. Unit tests also passed. | Verified live in test mode |
| Tenant model and docs | Migration has tenants, plans, subscriptions, usage events, indexes, and Stripe event IDs. `README.md`, `DESIGN.md`, `capstone.yaml`, `.env.example`, and this file are present. | Verified |

### Exact test output

```text
> node --test
✔ cached input is cheaper and reasoning is priced as output with exact integers
✔ retry mirrors first response and inserts one event; changed body conflicts
✔ quota allows exact boundary and rejects one more with 429; tenants stay isolated
✔ inactive subscription returns 402 without recording usage
✔ bad input is a clean 400 and never writes usage
✔ signed checkout upgrades once, stale webhook cannot undo it, forged signature fails
✔ unpaid and live-mode Stripe events never change the plan
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

### Local HTTP transcript

The same `POST /generate` with `Idempotency-Key: demo-request-001` was sent twice. Both responses were HTTP 200 with the same JSON body:

```json
{"accepted":true,"tenantId":"demo-orbit","month":"2026-10","usage":{"apiCalls":1,"inputTokens":100,"cachedInputTokens":20,"outputTokens":50,"reasoningTokens":10,"tokens":180},"cost":{"currency":"USD","microcents":569000,"centsRounded":1,"dollars":"0.00569000"}}
```

`GET /usage` afterwards returned:

```json
{"tenantId":"demo-orbit","month":"2026-10","plan":"free","subscriptionStatus":"active","used":{"apiCalls":1,"tokens":180,"inputTokens":100,"cachedInputTokens":20,"outputTokens":50,"reasoningTokens":10},"limit":{"apiCalls":1000,"tokens":100000},"cost":{"currency":"USD","microcents":569000,"centsRounded":1,"dollars":"0.00569000"}}
```

For the pricing vector of one million tokens in each category plus one API call, the exact result is 1,850,500,000 microcents = $18.50500000: fresh input $2.00, cached input $0.50, output $8.00, reasoning $8.00, API call $0.005.

### Background job output

```text
> npm run rollup
Monthly rollups refreshed.
```

The job is outside the HTTP path, retries three times on failure, logs each failure, emits an `ALERT:` line on final failure, and exits nonzero for an external scheduler to notify an operator.

## Shared requirements

1. **Layered architecture:** `server.js` handles HTTP, `meter.js` usage decisions, `pricing.js` math, `stripe.js` payment sync, `db.js` persistence. See `DESIGN.md`.
2. **Boundary validation:** the `bad input is a clean 400` test passes; missing/invalid keys and malformed JSON have explicit 4xx responses.
3. **Background job:** `npm run rollup` proof above, with retries and final failure alert.
4. **Persistence:** SQL migration, tenant foreign keys, and tenant/month index. Isolation is proved by `tenants stay isolated` test.
5. **Idempotency:** unique tenant/key constraint and retry test plus HTTP transcript above.
6. **Secrets:** `.env` is ignored; `.env.example` contains placeholders; key hashes are stored, not plaintext keys. `git ls-files` check is required before publication.
7. **AI cost tracking:** no model API is called. Token counts are simulated; the engine attributes their pinned cost to each tenant and enforces a monthly token quota.

## Live Stripe test-mode acceptance probe

The first Checkout attempt exposed an API compatibility issue: Stripe's current test API rejected `payment_method_types`. After removing that parameter, `POST /checkout` created a hosted sandbox session. The test Checkout completed using a Stripe test card, with no real money moved.

Stripe CLI reported the signed delivery:

```text
--> checkout.session.completed [evt_1UPcLY76zvwIhua0DRKLtsTS]
<-- [200] POST http://localhost:3000/webhooks/stripe [evt_1UPcLY76zvwIhua0DRKLtsTS]
```

`GET /usage` then returned HTTP 200 with the new plan and limits:

```json
{"tenantId":"demo-orbit","month":"2026-10","plan":"pro","subscriptionStatus":"active","used":{"apiCalls":0,"tokens":0,"inputTokens":0,"cachedInputTokens":0,"outputTokens":0,"reasoningTokens":0},"limit":{"apiCalls":100000,"tokens":10000000},"cost":{"currency":"USD","microcents":0,"centsRounded":0,"dollars":"0.00000000"}}
```

The actual event was fetched from Stripe's test Events API and replayed twice with valid local signatures. Both HTTP responses were 200:

```json
{"replay":1,"httpStatus":200,"result":{"received":true,"duplicate":true}}
{"replay":2,"httpStatus":200,"result":{"received":true,"duplicate":true}}
```

The database check showed `event_count=1` and `plan=pro,status=active`. Separately, a forged signature returned `HTTP/1.1 400 Bad Request` with `{"error":"invalid_signature"...}`; it did not create an event or alter the plan.
