-- Manual migration (2026-10-30) — payment-safety/partial-payments/
-- reconciliation rework. Same reason every other manual migration in this
-- folder exists: this project uses `prisma db push`, not Prisma Migrate (no
-- migrations/ folder), and `prisma db push` has never been runnable from
-- this dev machine (local Prisma engine cannot complete a real DB
-- connection at all — a long-standing, unresolved environment issue, not a
-- credentials problem). Run this in Supabase's SQL Editor BEFORE deploying
-- the matching code change, so the live app is never briefly out of sync
-- with the DB mid-deploy.
--
-- What this does:
--   1. Extends `payments` with the unified-ledger columns (paise amounts,
--      allocation, source, UTR, verification status, idempotency key) and
--      a direct invoice_id FK.
--   2. Adds four new tables: payment_link_history, payment_link_transitions,
--      payment_reconciliation_exceptions, bank_transactions.
--   3. Extends `invoices` with invoice_payment_status and payment_token.
--   4. Adds a UNIQUE constraint on payments.razorpay_payment_id — this is
--      the real fix for the webhook-dedup bug (see src/services/
--      orderService.ts::recordOnlinePayment / the delivery report).
--
-- Verified by inspection and by `npx prisma generate` (schema validation —
-- does not need a DB connection) succeeding against the matching
-- schema.prisma changes; NOT verified by an actual `prisma db push` run,
-- same caveat as every prior manual migration in this folder.

BEGIN;

-- 1. payments: unified-ledger columns -----------------------------------

ALTER TABLE payments
  ADD COLUMN invoice_id uuid REFERENCES invoices(id),
  ADD COLUMN amount_paise bigint NOT NULL DEFAULT 0,
  ADD COLUMN allocated_paise bigint NOT NULL DEFAULT 0,
  ADD COLUMN payment_source varchar(20) NOT NULL DEFAULT 'cash',
  ADD COLUMN utr_reference varchar(50),
  ADD COLUMN is_duplicate_utr_suspected boolean NOT NULL DEFAULT false,
  ADD COLUMN verification_status varchar(20) NOT NULL DEFAULT 'verified',
  ADD COLUMN verified_by uuid REFERENCES users(id),
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN idempotency_key varchar(100);

-- Backfill: every pre-existing payment row was, by definition, already
-- fully recorded and counted toward its order's paid status under the old
-- single-shot model — so amount_paise/allocated_paise both equal the
-- existing `amount` column converted to paise, and verification_status
-- stays the column default ('verified'). invoice_id is backfilled from the
-- 1:1 orders -> invoices relationship.
UPDATE payments p
SET amount_paise = ROUND(p.amount * 100)::bigint,
    allocated_paise = ROUND(p.amount * 100)::bigint,
    invoice_id = i.id
FROM invoices i
WHERE i.order_id = p.order_id;

-- The real webhook-dedup fix (payment-safety review section 8) — a
-- Postgres UNIQUE constraint treats every NULL as distinct, so this only
-- actually constrains real Razorpay payment ids, never staff-recorded
-- cash/bank_upi rows.
ALTER TABLE payments ADD CONSTRAINT payments_razorpay_payment_id_key UNIQUE (razorpay_payment_id);
ALTER TABLE payments ADD CONSTRAINT payments_idempotency_key_key UNIQUE (idempotency_key);

ALTER TABLE payments ADD CONSTRAINT payments_payment_source_check
  CHECK (payment_source IN ('razorpay', 'cash', 'bank_upi'));
ALTER TABLE payments ADD CONSTRAINT payments_verification_status_check
  CHECK (verification_status IN ('pending', 'verified', 'rejected'));

CREATE INDEX idx_payments_invoice ON payments(invoice_id);

-- 2. New tables -----------------------------------------------------------

CREATE TABLE payment_link_history (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id               UUID NOT NULL REFERENCES invoices(id),
    razorpay_payment_link_id VARCHAR(100) NOT NULL,
    payment_link_url         TEXT NOT NULL,
    amount_paise             BIGINT NOT NULL,
    final_status             VARCHAR(20) NOT NULL
        CHECK (final_status IN ('created', 'paid', 'cancelled', 'expired', 'superseded', 'cancel_uncertain')),
    retired_reason           VARCHAR(30)
        CHECK (retired_reason IN ('reissue', 'cash_full', 'cash_partial', 'bank_upi_full', 'bank_upi_partial', 'discount_change', 'amount_revision')),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    retired_at               TIMESTAMPTZ
);
CREATE INDEX idx_link_history_invoice ON payment_link_history(invoice_id);

CREATE TABLE payment_link_transitions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id          UUID NOT NULL REFERENCES invoices(id),
    status              VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'cancelling_old_link', 'creating_new_link', 'completed', 'failed_needs_review')),
    reason              VARCHAR(30) NOT NULL
        CHECK (reason IN ('cash_full', 'cash_partial', 'bank_upi_full', 'bank_upi_partial', 'reissue')),
    old_payment_link_id VARCHAR(100),
    new_payment_link_id VARCHAR(100),
    triggered_by        UUID REFERENCES users(id),
    error_detail        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_link_transition_invoice ON payment_link_transitions(invoice_id);
CREATE INDEX idx_link_transition_status ON payment_link_transitions(status);

CREATE TABLE payment_reconciliation_exceptions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id         UUID NOT NULL REFERENCES invoices(id),
    customer_id        UUID NOT NULL REFERENCES customers(id),
    exception_type     VARCHAR(30) NOT NULL
        CHECK (exception_type IN ('overpayment', 'duplicate_utr', 'cancellation_uncertain', 'monthly_billing_anomaly')),
    collected_paise     BIGINT NOT NULL,
    allocated_paise     BIGINT NOT NULL,
    excess_paise        BIGINT NOT NULL DEFAULT 0,
    related_payment_ids UUID[] NOT NULL DEFAULT '{}',
    status              VARCHAR(30) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'resolved_refunded', 'resolved_credited', 'resolved_other')),
    resolution_notes     TEXT,
    resolved_by          UUID REFERENCES users(id),
    resolved_at          TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reconciliation_invoice ON payment_reconciliation_exceptions(invoice_id);
CREATE INDEX idx_reconciliation_status ON payment_reconciliation_exceptions(status);

CREATE TABLE bank_transactions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_account_ref   VARCHAR(100) NOT NULL,
    utr_reference      VARCHAR(50) NOT NULL,
    amount_paise       BIGINT NOT NULL,
    transaction_date   DATE NOT NULL,
    direction          VARCHAR(10) NOT NULL CHECK (direction IN ('credit', 'debit')),
    raw_description    TEXT,
    matched_payment_id UUID UNIQUE REFERENCES payments(id),
    match_status       VARCHAR(20) NOT NULL DEFAULT 'unmatched'
        CHECK (match_status IN ('unmatched', 'matched', 'ambiguous', 'ignored')),
    import_batch_id    UUID NOT NULL,
    imported_by        UUID NOT NULL REFERENCES users(id),
    imported_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bank_tx_utr ON bank_transactions(utr_reference);
CREATE INDEX idx_bank_tx_match_status ON bank_transactions(match_status);

-- 3. invoices: ledger status + controlled-URL token ----------------------

ALTER TABLE invoices
  ADD COLUMN invoice_payment_status varchar(20) NOT NULL DEFAULT 'unpaid',
  ADD COLUMN payment_token varchar(64);

ALTER TABLE invoices ADD CONSTRAINT invoices_payment_token_key UNIQUE (payment_token);
ALTER TABLE invoices ADD CONSTRAINT invoices_invoice_payment_status_check
  CHECK (invoice_payment_status IN ('unpaid', 'partially_paid', 'paid'));

-- Backfill: an already-paid order's invoice should read as 'paid', not the
-- new column's default 'unpaid' — matches the existing orders.payment_status
-- this column is meant to mirror going forward.
UPDATE invoices i
SET invoice_payment_status = 'paid'
FROM orders o
WHERE o.id = i.order_id AND o.payment_status = 'paid';

COMMIT;

-- After running this, deploy the matching backend commit. Every invoice's
-- payment_token will be backfilled lazily — the NEXT time generateInvoice
-- runs for that order (a pickup, reissue, discount change, or amount
-- revision), per src/services/payTokenService.ts::ensurePaymentToken. An
-- invoice that never gets touched again simply never gets a token, which
-- is fine — nothing currently depends on one existing (GET /pay/:token
-- isn't wired into any live WhatsApp button yet, see the delivery report).
