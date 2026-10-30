-- Manual migration (2026-10-30) — outstanding payments / previous dues /
-- admin reminders / aging reports rework. Same standing reason as every
-- other file in this folder: this project uses `prisma db push`, not
-- Prisma Migrate, and `prisma db push` has never been runnable from this
-- dev machine (local Prisma engine can't complete a real DB connection at
-- all). Run this in Supabase's SQL Editor BEFORE deploying the matching
-- code — and only AFTER the two migrations that precede it in this same
-- folder, in this order:
--   1. 2026-10-30_rename_whatsapp_number_add_secondary.sql
--   2. 2026-10-30_payment_safety_rework.sql
--   3. this file
--
-- What this does:
--   1. invoices: adds due_date (invoice date + 4 days, backfilled below).
--   2. payments: adds payment_request_id (nullable FK, for a payment that
--      came in through a combined PaymentRequest rather than one invoice).
--   3. Makes payment_link_history / payment_link_transitions /
--      payment_reconciliation_exceptions polymorphic: invoice_id becomes
--      nullable, each gains a payment_request_id column — a PaymentRequest's
--      own link lifecycle reuses these same tables.
--   4. New tables: payment_allocations, payment_allocation_corrections,
--      payment_requests, payment_request_invoices,
--      invoice_previous_dues_lines, payment_reminder_log.
--   5. Backfill: one PaymentAllocation row per existing verified Payment
--      that already has an invoice_id, mirroring its own allocated_paise —
--      so reports built against payment_allocations see pre-existing
--      payments too, not just ones recorded after this deploys.
--
-- Verified by inspection and by `npx prisma generate` (schema validation —
-- no DB connection needed) succeeding against the matching schema.prisma
-- changes; NOT verified by an actual `prisma db push` run or against the
-- live database, same caveat as every prior manual migration in this
-- folder.

BEGIN;

-- 1. invoices: due date -----------------------------------------------

ALTER TABLE invoices ADD COLUMN due_date date;

UPDATE invoices SET due_date = (created_at::date + INTERVAL '4 days') WHERE due_date IS NULL;

-- 2. payments: combined-request link -----------------------------------

ALTER TABLE payments ADD COLUMN payment_request_id uuid;
CREATE INDEX idx_payments_payment_request ON payments(payment_request_id);

-- 3. New tables (payment_requests first — everything else below
-- references it) ---------------------------------------------------------

CREATE TABLE payment_requests (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id              UUID NOT NULL REFERENCES customers(id),
    required_paise           BIGINT NOT NULL,
    razorpay_payment_link_id VARCHAR(100),
    payment_link_url         TEXT,
    payment_link_status      VARCHAR(20) DEFAULT 'created'
        CHECK (payment_link_status IN ('created', 'paid', 'cancelled', 'expired')),
    payment_token            VARCHAR(64) UNIQUE,
    status                   VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'cancelled')),
    created_by               UUID NOT NULL REFERENCES users(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payment_request_customer ON payment_requests(customer_id);

ALTER TABLE payments ADD CONSTRAINT payments_payment_request_id_fkey
  FOREIGN KEY (payment_request_id) REFERENCES payment_requests(id);

CREATE TABLE payment_request_invoices (
    id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_request_id             UUID NOT NULL REFERENCES payment_requests(id),
    invoice_id                     UUID NOT NULL REFERENCES invoices(id),
    outstanding_at_creation_paise  BIGINT NOT NULL,
    UNIQUE (payment_request_id, invoice_id)
);

CREATE TABLE payment_allocations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id      UUID NOT NULL REFERENCES payments(id),
    invoice_id      UUID NOT NULL REFERENCES invoices(id),
    allocated_paise BIGINT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_allocation_payment ON payment_allocations(payment_id);
CREATE INDEX idx_allocation_invoice ON payment_allocations(invoice_id);

CREATE TABLE payment_allocation_corrections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id      UUID NOT NULL REFERENCES payments(id),
    from_invoice_id UUID NOT NULL REFERENCES invoices(id),
    to_invoice_id   UUID NOT NULL REFERENCES invoices(id),
    amount_paise    BIGINT NOT NULL,
    reason          TEXT NOT NULL,
    corrected_by    UUID NOT NULL REFERENCES users(id),
    corrected_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_correction_payment ON payment_allocation_corrections(payment_id);

CREATE TABLE invoice_previous_dues_lines (
    id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id                   UUID NOT NULL REFERENCES invoices(id),
    prior_invoice_id             UUID NOT NULL REFERENCES invoices(id),
    outstanding_at_snapshot_paise BIGINT NOT NULL,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_prev_dues_invoice ON invoice_previous_dues_lines(invoice_id);

CREATE TABLE payment_reminder_log (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id               UUID NOT NULL REFERENCES customers(id),
    sent_by                   UUID NOT NULL REFERENCES users(id),
    invoice_ids               UUID[] NOT NULL DEFAULT '{}',
    outstanding_at_send_paise BIGINT NOT NULL,
    recipient_phone_numbers   TEXT[] NOT NULL DEFAULT '{}',
    template_name             VARCHAR(100) NOT NULL,
    provider_message_ids      TEXT[] NOT NULL DEFAULT '{}',
    delivery_status           VARCHAR(20) NOT NULL DEFAULT 'sent' CHECK (delivery_status IN ('sent', 'partial', 'failed')),
    failure_reason            TEXT,
    sent_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reminder_customer ON payment_reminder_log(customer_id, sent_at);

-- 4. Polymorphic widening of the existing payment-safety-rework tables ----

ALTER TABLE payment_link_history ALTER COLUMN invoice_id DROP NOT NULL;
ALTER TABLE payment_link_history ADD COLUMN payment_request_id uuid REFERENCES payment_requests(id);
CREATE INDEX idx_link_history_payment_request ON payment_link_history(payment_request_id);

ALTER TABLE payment_link_transitions ALTER COLUMN invoice_id DROP NOT NULL;
ALTER TABLE payment_link_transitions ADD COLUMN payment_request_id uuid REFERENCES payment_requests(id);
CREATE INDEX idx_link_transition_payment_request ON payment_link_transitions(payment_request_id);

ALTER TABLE payment_reconciliation_exceptions ALTER COLUMN invoice_id DROP NOT NULL;
ALTER TABLE payment_reconciliation_exceptions ADD COLUMN payment_request_id uuid REFERENCES payment_requests(id);
CREATE INDEX idx_reconciliation_payment_request ON payment_reconciliation_exceptions(payment_request_id);

-- 5. Backfill: mirror every pre-existing verified, invoice-linked payment
-- into payment_allocations, so reports/statements built against that
-- table see payments recorded before this deploy too.

INSERT INTO payment_allocations (payment_id, invoice_id, allocated_paise, created_at)
SELECT id, invoice_id, allocated_paise, created_at
FROM payments
WHERE invoice_id IS NOT NULL AND allocated_paise > 0;

COMMIT;
