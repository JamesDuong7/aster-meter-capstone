# Evidence

Recorded 2026-10-11 (Pacific time). Commands were run in this repository. Local HTTP probes used a demo database outside the repository. No real Stripe account, test price, or CLI was available, so the external Checkout gate remains **pending**; the webhook behavior below is exercised with representative signed test events.

`BUILDLOG.md` is intentionally absent per the project owner's instruction to ignore the brief's AI-use log rule. The brief also lists it as a machine-checked submission file, so the repository is not yet submission-complete under that rubric.

## Section 6 requirements

| Requirement | Proof | Status |
| --- | --- | --- |
| One event under retries | `retry mirrors first response and inserts one event; changed body conflicts` passed; local HTTP replay returned byte-identical JSON and `GET /usage` showed one API call. Unique `(tenant_id,idempotency_key)` constraint in migration. | Verified |
| Quota enforcement and status | `quota allows exact boundary and rejects one more with 429` and `inactive subscription returns 402` passed. | Verified |
| Monthly cost and token rules | `cached input is cheaper and reasoning is priced as output with exact integers` passed; `GET /usage` total shown below. | Verified |
| Checkout session against Stripe test mode | `/checkout` uses `sk_test_` and a recurring `price_` ID, but no Stripe account or price was available for an external run. | **Pending external proof** |
| Signed, deduplicated webhooks and plan sync | `signed checkout upgrades once, stale webhook cannot undo it, forged signature fails` passed; `unpaid and live-mode Stripe events never change the plan` passed. | Verified locally |
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

## Remaining external acceptance probe

After a free Stripe test account and recurring Pro price exist: set the three Stripe values in local `.env`, run `stripe listen --forward-to localhost:3000/webhooks/stripe`, complete Checkout from `POST /checkout`, and paste the resulting webhook/`GET /usage` transcript here. A genuine `checkout.session.completed` should change the tenant from Free to Pro. This has **not** been claimed as verified.
