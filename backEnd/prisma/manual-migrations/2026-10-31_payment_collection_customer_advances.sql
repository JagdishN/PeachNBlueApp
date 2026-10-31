-- Manual migration (2026-10-31) — Payment Collection, Customer Advances,
-- Razorpay Link Management & Notifications. Same standing reason as every
-- other file in this folder: this project uses `prisma db push`, not
-- Prisma Migrate, and `prisma db push` has never been runnable from this
-- dev machine. Run this in Supabase's SQL Editor BEFORE deploying the
-- matching code — and only AFTER the five migrations that precede it in
-- this same folder, in this order:
--   1. 2026-10-30_rename_whatsapp_number_add_secondary.sql
--   2. 2026-10-30_payment_safety_rework.sql
--   3. 2026-10-30_outstanding_dues_rework.sql
--   4. 2026-10-30_admin_override_vendor_invoices.sql
--   5. 2026-10-31_webhook_historical_link_resolution.sql
--   6. this file
--
-- What this does:
--   1. New table customer_credits — append-only advance/credit ledger
--      (Phase 4). A customer's available balance is always derived by
--      summing this table, never stored as a mutable column.
--   2. New table notification_outbox — a minimal durable retry queue for
--      a failed WhatsApp send (Phase 6).
--   3. payments gains amount_tendered_paise / change_returned_paise
--      (nullable, cash-only) — keeps "tendered," "retained," and "change
--      returned" as three distinct figures (Phase 8).
--   4. payment_reconciliation_exceptions.exception_type's CHECK constraint
--      is extended with 'unapplied_cash_pending_review' (Phase 3 Option
--      C) — reusing the existing exception model rather than a parallel
--      one, since its shape (collected/allocated/excess + resolution
--      fields) already fits.
--
-- Verified by inspection and by `npx prisma generate` (schema validation —
-- no DB connection needed) succeeding against the matching schema.prisma
-- changes; NOT verified by an actual `prisma db push` run or against the
-- live database, same caveat as every prior manual migration in this
-- folder.

BEGIN;

-- 1. customer_credits -----------------------------------------------------

CREATE TABLE customer_credits (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id            UUID NOT NULL REFERENCES customers(id),
    transaction_type       VARCHAR(20) NOT NULL
        CHECK (transaction_type IN ('issued', 'applied', 'refunded', 'reversed')),
    amount_paise           BIGINT NOT NULL CHECK (amount_paise > 0),
    source_payment_id      UUID REFERENCES payments(id),
    applied_to_invoice_id  UUID REFERENCES invoices(id),
    resolved_exception_id  UUID,
    reversal_of_id         UUID REFERENCES customer_credits(id),
    reason                 TEXT,
    -- Nullable — same convention as payments.recorded_by: null means "the
    -- system" (the auto-consumption at invoice generation has no human
    -- actor), not a missing audit trail for a human action.
    created_by             UUID REFERENCES users(id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_credit_customer ON customer_credits(customer_id, created_at);
CREATE INDEX idx_customer_credit_invoice ON customer_credits(applied_to_invoice_id);

-- 2. notification_outbox ---------------------------------------------------

CREATE TABLE notification_outbox (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id             UUID REFERENCES customers(id),
    recipient_phone_number  VARCHAR(20) NOT NULL,
    from_number             VARCHAR(20) NOT NULL,
    template_name           VARCHAR(100) NOT NULL,
    template_language       VARCHAR(10) NOT NULL DEFAULT 'en',
    body_variables          TEXT[] NOT NULL,
    button_url_param        TEXT,
    header_media_url        TEXT,
    header_type             VARCHAR(10),
    status                  VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'abandoned')),
    attempts                INT NOT NULL DEFAULT 0,
    last_error              TEXT,
    next_retry_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notification_outbox_retry ON notification_outbox(status, next_retry_at);

-- 3. payments: tendered / change-returned ----------------------------------

ALTER TABLE payments ADD COLUMN amount_tendered_paise BIGINT;
ALTER TABLE payments ADD COLUMN change_returned_paise BIGINT;

-- 4. payment_reconciliation_exceptions: extend exception_type -------------

ALTER TABLE payment_reconciliation_exceptions
    DROP CONSTRAINT payment_reconciliation_exceptions_exception_type_check;
ALTER TABLE payment_reconciliation_exceptions
    ADD CONSTRAINT payment_reconciliation_exceptions_exception_type_check
    CHECK (exception_type IN (
        'overpayment', 'duplicate_utr', 'cancellation_uncertain',
        'monthly_billing_anomaly', 'unapplied_cash_pending_review'
    ));

COMMIT;
