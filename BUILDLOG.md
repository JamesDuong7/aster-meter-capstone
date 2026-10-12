# Build log

This capstone was substantially built with Codex AI assistance. The log records what the assistant produced, what testing showed was wrong, and what was changed. It does not claim the project owner wrote the implementation by hand or has already reviewed every line.

## Who did what

- **Project owner:** requested the capstone, authorized a separate public repository, supplied the Stripe test account and recurring Pro price through a local ignored `.env`, and completed the hosted Stripe Sandbox Checkout using a test card. The owner later requested this log.
- **Codex AI assistant:** interpreted the brief, chose the small Node.js/SQLite design, wrote the schema, metering and quota logic, pricing math, Stripe integration, tests, README, design document, evidence transcript, and this log. It ran the tests and local API probes, operated Stripe CLI in test mode, inspected the results, and committed/pushed the project.

The owner should review the code before an evaluation that asks them to explain specific lines. This log is an account of the build, not evidence of that review.

## Where AI helped

| Area | AI contribution | How it was checked |
| --- | --- | --- |
| Design | Split HTTP, metering, pricing, Stripe, and persistence into separate modules; designed tenant-scoped idempotency and a SQLite migration. | `DESIGN.md`, schema inspection, tenant-isolation and retry tests. |
| Billing logic | Wrote quota checks at the exact boundary and integer microcent pricing for fresh input, cached input, output, and reasoning tokens. | Boundary, 402/429, and exact-cost tests; local `/generate` and `/usage` requests. |
| Stripe integration | Wrote test Checkout creation, raw-body HMAC verification, event deduplication, and subscription mirroring. | Live Stripe Sandbox Checkout, signed CLI webhook delivery, replay of the real event, and a forged-signature request. |
| Documentation | Drafted setup instructions, architecture sketch, limits, and evidence. | Compared the documented commands and outputs with actual runs; no secrets were included in committed files. |

## Where AI was wrong and what changed

1. **Quota test asserted the wrong boundary.** The first test expected a zero-token request to fail after the token quota was exactly full. A zero-token request still fits that quota, so the test was corrected to request one additional token. The implementation's `used + requested > limit` rule stayed the same.
2. **Retry response initially differed from the first response.** An early version added replay metadata and returned an event ID that was absent from the stored response. The response was simplified and stored verbatim so the same idempotency key and quantities return identical JSON. The retry test and HTTP transcript verify this.
3. **Money display initially used floating-point formatting.** Although stored amounts were integers, the display string briefly used a floating-point conversion. It was replaced with integer division and zero-padded fractional digits. The test now checks a tiny nonzero amount as well as the larger pricing vector.
4. **Stripe Checkout request used an obsolete parameter.** The first live test returned a Stripe error saying `payment_method_types` was no longer supported for the account's API version. The parameter was removed, and the next test created a `cs_test_` session. The owner completed that Sandbox Checkout and the signed webhook upgraded the tenant.

## Verification and remaining limits

- `npm test`: 7 passed, 0 failed.
- Two identical local billable requests produced one usage event and identical JSON responses.
- A real Stripe test-mode Checkout changed the demo tenant from Free to Pro. The signed event was stored once; two replays returned `duplicate:true`. A forged signature returned HTTP 400.
- `.env` is git-ignored and local-only. It contains test credentials and was not committed. The repository includes `.env.example` with placeholders.
- The service simulates AI token quantities; it does not call a model. No real payment, invoice, proration, or overage flow was built. SQLite protects one local database file, and same-second Stripe event ordering remains a documented limitation.

See `EVIDENCE.md` for the exact outputs and `README.md` for setup and known limitations.
