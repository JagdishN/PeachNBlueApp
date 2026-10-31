# Reproducible PostgreSQL Integration Test Plan — Webhook Historical-Link Resolution

**Status:** Not yet executed. This plan exists because this Claude Code session's sandbox has no Docker, no local Postgres, and its auto-mode safety classifier blocks running a freshly-downloaded third-party native binary (`embedded-postgres`) without explicit approval — so genuine real-database, real-transaction, real-concurrency evidence could not be produced from inside that environment. Everything in this plan is designed to be run by a human (or CI) in an environment that can grant that permission, **never against the production/live Supabase database.**

## What this verifies that mocked-Prisma unit tests cannot

- Real PostgreSQL row-level locking (`SELECT ... FOR UPDATE` in `paymentLedgerService.ts::lockInvoiceForUpdate`) under genuine concurrent access — a mocked `PrismaClient` has no locking semantics at all, so every existing "concurrency" claim in the unit-test suite is actually just sequential-call-order logic, not real serialization.
- That all five pending manual migration files, applied **in order**, produce a schema that genuinely matches what `schema.prisma` expects — not just that each file's SQL is syntactically valid in isolation.
- That the real `UNIQUE` constraints (`payments.razorpay_payment_id`, `unmatched_provider_payments.razorpay_payment_id`, `invoice_adjustments.idempotency_key`, etc.) actually exist and are actually enforced by Postgres, not just declared in `schema.prisma`.

## 0. Safety rules (non-negotiable)

1. **Never point this at the real `DATABASE_URL`/Supabase project.** Use a disposable, local-only Postgres instance for every step below.
2. **Never use live Razorpay keys.** Mock `src/lib/razorpayClient.ts`'s `createPaymentLink`/`cancelPaymentLink`/`verifyWebhookSignature`'s underlying HTTP calls (or use Razorpay test-mode keys, per CLAUDE.md's existing precedent for this project) — this plan tests the database/locking layer, not Razorpay's API itself.
3. **Never use real customer data.** All seed data below is synthetic.
4. Tear down the disposable database/container after each run. Nothing here should persist.

## 1. Environment

Either works; Docker is simpler if available in the target environment:

**Option A — Docker (preferred if available):**
```bash
docker run --rm -d --name pb-test-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16
```

**Option B — `embedded-postgres` (no Docker needed, what this session attempted but could not execute):**
```bash
npm install --no-save embedded-postgres
node -e "
const EmbeddedPostgres = require('embedded-postgres');
const pg = new EmbeddedPostgres({ databaseDir: './pgdata-test', port: 55432, user: 'postgres', password: 'test' });
(async () => { await pg.initialise(); await pg.start(); console.log('ready'); })();
"
```
Whoever runs this must explicitly approve the native-binary execution step for their own tooling — this is exactly the step this session's sandbox blocked.

Set for the rest of this plan:
```bash
export TEST_DATABASE_URL="postgresql://postgres:test@localhost:55432/postgres"
```

## 2. Apply the base schema, then all five migrations sequentially

The live Supabase database never runs `prisma db push` — it only ever runs the hand-written files in `backEnd/prisma/manual-migrations/`. To genuinely test "do these five files, in order, produce what `schema.prisma` expects," reconstruct that same path rather than just pushing the current schema directly:

```bash
# 2a. Get the last-committed (pre-all-five-migrations) schema as the "production today" baseline.
git show HEAD:backEnd/prisma/schema.prisma > /tmp/schema_base.prisma

# 2b. Push that base schema to the disposable DB.
DATABASE_URL="$TEST_DATABASE_URL" npx prisma db push --schema=/tmp/schema_base.prisma --skip-generate

# 2c. Apply the five migrations IN THIS EXACT ORDER (use `psql` or the `pg` npm
#     package — node-postgres's Client.query() with a plain multi-statement
#     string uses the simple query protocol, which supports this):
for f in \
  "backEnd/prisma/manual-migrations/2026-10-30_rename_whatsapp_number_add_secondary.sql" \
  "backEnd/prisma/manual-migrations/2026-10-30_payment_safety_rework.sql" \
  "backEnd/prisma/manual-migrations/2026-10-30_outstanding_dues_rework.sql" \
  "backEnd/prisma/manual-migrations/2026-10-30_admin_override_vendor_invoices.sql" \
  "backEnd/prisma/manual-migrations/2026-10-31_webhook_historical_link_resolution.sql" \
; do
  echo "Applying $f"
  psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || { echo "FAILED at $f"; exit 1; }
done
```

## 3. Validate the result matches `schema.prisma` exactly

This is the strongest, cleanest signal for "did the five migrations fully and correctly reconstruct the intended schema" — a non-destructive diff, not a second `db push`:

```bash
npx prisma migrate diff \
  --from-url "$TEST_DATABASE_URL" \
  --to-schema-datamodel backEnd/prisma/schema.prisma \
  --script
```

**Expected result: empty output (or only comment lines).** Any real `ALTER`/`CREATE` statement in the output means the five migration files do not yet fully produce what `schema.prisma` expects — a gap to close before trusting this schema against the real Supabase project.

## 4. Seed minimal realistic data

```sql
-- One branch, one admin, one staff, one customer, one order, one invoice
-- (₹500), via psql or a small seed script using the real Prisma Client
-- pointed at TEST_DATABASE_URL. Keep this minimal — the point is exercising
-- the ledger functions for real, not a full realistic dataset.
```

## 5. Scenario tests — run against the REAL Prisma Client (not mocked), pointed at `TEST_DATABASE_URL`

For each, call the actual exported functions (`paymentLedgerService.ts::recordVerifiedPayment`, `webhookController.ts`'s resolution logic — export `resolveInvoiceForLink` for direct testing, or drive it through the real `razorpayWebhookHandler` with a genuinely computed HMAC signature and only the Razorpay/MSG91 network calls mocked) against the seeded invoice:

1. **Normal active-link payment** — baseline, confirms nothing regressed.
2. **Late payment after an admin waiver** — create a real `InvoiceAdjustment` row (via the real `closeOutstandingBalance` service call, not a raw insert, so its own side effects run for real too), then send the late webhook. Assert: a `PaymentReconciliationException` row exists with `exceptionType = 'overpayment'`; `invoices.invoice_payment_status` is still `'paid'`; the `InvoiceAdjustment` row is completely untouched (same `reversedAt IS NULL`, same `amountPaise`).
3. **Late payment after a real reissue** — call `invoiceService.ts::generateInvoice` a second time for the same order (mocking only `createPaymentLink`/`cancelPaymentLink`'s network calls), confirm a real `payment_link_history` row was written with `retired_reason = 'reissue'`, then send a late webhook for the pre-reissue link id. Assert it resolves to the same invoice and allocates against the **current** (post-reissue) outstanding.
4. **Late payment after full cash settlement** — call `orderService.ts::recordPayment` for the full amount in cash (real DB write, real `retireOrReplaceLink` call with mocked network), then send a late webhook for the now-retired link with the original full amount. Assert a full-amount overpayment exception, status stays `'paid'`.
5. **Late payment after partial cash + link replacement** — call `recordPayment` for a partial cash amount, then send a late webhook for the old link's **original full amount**. Assert the single resulting `Payment` row splits correctly: `allocated_paise` covers exactly the remaining real balance, `excess_paise` captures the rest — confirms the mixed allocate+excess path actually commits correctly under real Postgres `BigInt`/transaction semantics, not just mocked arithmetic.
6. **Unknown link** — send a webhook for a link id that matches neither the active lookup nor any `payment_link_history` row. Assert exactly one row lands in `unmatched_provider_payments`; redeliver the identical webhook and assert still exactly one row (real unique-constraint enforcement, not a mocked assumption).

## 6. Concurrency test — the one thing mocked Prisma genuinely cannot prove

```js
// Two SEPARATE PrismaClient instances (simulating two concurrent webhook
// requests/processes), both pointed at TEST_DATABASE_URL, firing
// recordVerifiedPayment for the SAME invoice at (as close to) the same
// instant — e.g. via Promise.all, or two child processes started together.
const [clientA, clientB] = [new PrismaClient(), new PrismaClient()];

await Promise.all([
  clientA.$transaction((tx) => recordVerifiedPayment(tx, { invoiceId, ...paymentA })),
  clientB.$transaction((tx) => recordVerifiedPayment(tx, { invoiceId, ...paymentB })),
]);

// Assertions against the REAL post-state:
// - sum of both payments' allocatedPaise never exceeds the invoice's requiredPaise
// - outstandingPaise is never negative
// - exactly one PaymentAllocation row per payment (no double-write from a lock failure/retry)
// - if the combined gross exceeds required, exactly one overpayment exception
//   captures the correct total excess (not two partial/inconsistent ones)
```

Run this at least 20–50 times in a loop (concurrency bugs are often intermittent) before trusting the result either way.

## 7. Consistency check against existing data

If a sanitized copy/snapshot of real pre-existing invoices/payments/waivers is available (with all customer PII scrubbed — **never real customer data**, per the safety rules above), restore it into the disposable DB, apply the five migrations, and compare `getInvoicePaymentSummary` output for a sample of invoices before vs. after. Any numeric drift is a real regression, not a theoretical one.

## 9. Addendum (2026-10-31) — Payment collection / customer advances rework

Adds two scenarios to section 6's concurrency test, using the same disposable-Postgres setup (sections 1–3) and the same real-client approach:

- **Concurrent cash payment + Razorpay webhook, same invoice**: fire a real `recordPayment` (via `orderService.ts`, mocking only the Razorpay/MSG91 network calls) and a real `recordOnlinePayment` webhook delivery at the same instant against the same invoice. Assert: the sum of both payments' `allocatedPaise` never exceeds `requiredPaise`; exactly one of them produces the excess (as an exception or a credit, depending on which arrived "second" under the real lock); no double-allocation.
- **Concurrent credit auto-consumption**: generate two invoices for the SAME customer at nearly the same instant (e.g. two orders created back-to-back), both eligible to auto-consume the same available credit balance. Assert: the combined `applied` total across both never exceeds the customer's real available balance at the time (`lockCustomerCreditForUpdate` serializes this correctly) — this is the one thing a mocked-Prisma unit test cannot prove, since `getCustomerCreditBalance`'s "read current balance, then spend it" is exactly the double-spend window a real `SELECT ... FOR UPDATE` closes and a mock cannot.

Also add migration 6 to the sequential list in section 2:

```
"backEnd/prisma/manual-migrations/2026-10-31_payment_collection_customer_advances.sql"
```

## 10. Report format

For each of the 13 points above, record: pass/fail, the actual query/assertion output, and the Postgres server log line (if any) for the relevant transaction — this is what turns "I ran it" into verifiable evidence, the same bar this entire audit has been held to.
