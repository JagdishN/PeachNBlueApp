-- Manual migration (2026-10-30) — Admin Payment Override (invoice waivers)
-- and Third-Party Vendor Invoice Management. Same standing reason as every
-- other file in this folder: this project uses `prisma db push`, not
-- Prisma Migrate, and `prisma db push` has never been runnable from this
-- dev machine (local Prisma engine can't complete a real DB connection at
-- all). Run this in Supabase's SQL Editor BEFORE deploying the matching
-- code — and only AFTER the three migrations that precede it in this same
-- folder, in this order:
--   1. 2026-10-30_rename_whatsapp_number_add_secondary.sql
--   2. 2026-10-30_payment_safety_rework.sql
--   3. 2026-10-30_outstanding_dues_rework.sql
--   4. this file
--
-- What this does:
--   1. New table invoice_adjustments — admin waiver/write-off records
--      against an existing invoice. Never a fake Payment row; subtracted
--      from outstanding at read-time by paymentLedgerService.ts, not by
--      mutating invoices.amount.
--   2. New tables vendor_invoices / vendor_invoice_audit — fully separate
--      from the customer invoice/payment/ledger tables above; internal
--      expense tracking only, no FK into any of them.
--
-- Verified by inspection and by `npx prisma generate` (schema validation —
-- no DB connection needed) succeeding against the matching schema.prisma
-- changes; NOT verified by an actual `prisma db push` run or against the
-- live database, same caveat as every prior manual migration in this
-- folder.

BEGIN;

-- 1. invoice_adjustments ------------------------------------------------

CREATE TABLE invoice_adjustments (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id         UUID NOT NULL REFERENCES invoices(id),
    adjustment_type    VARCHAR(20) NOT NULL DEFAULT 'waiver',
    amount_paise       BIGINT NOT NULL CHECK (amount_paise > 0),
    reason_category    VARCHAR(30) NOT NULL
        CHECK (reason_category IN ('goodwill', 'discount_adjustment', 'billing_correction', 'other')),
    reason             TEXT NOT NULL,
    created_by         UUID NOT NULL REFERENCES users(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    idempotency_key    VARCHAR(100) UNIQUE,
    link_transition_id UUID,
    reversed_at        TIMESTAMPTZ,
    reversed_by        UUID REFERENCES users(id),
    reversal_reason    TEXT
);
CREATE INDEX idx_invoice_adjustment_invoice ON invoice_adjustments(invoice_id);

-- 2. vendor_invoices / vendor_invoice_audit ------------------------------

CREATE TABLE vendor_invoices (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_name   VARCHAR(150) NOT NULL,
    description   TEXT,
    service_type  VARCHAR(30) NOT NULL
        CHECK (service_type IN ('wash_fold', 'wash_fold_iron', 'dry_cleaning')),
    amount_paise  BIGINT NOT NULL CHECK (amount_paise > 0),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid')),
    branch_id     UUID REFERENCES branches(id),
    created_by    UUID NOT NULL REFERENCES users(id),
    updated_by    UUID REFERENCES users(id),
    paid_at       TIMESTAMPTZ,
    paid_by       UUID REFERENCES users(id),
    voided_at     TIMESTAMPTZ,
    voided_by     UUID REFERENCES users(id),
    void_reason   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vendor_invoice_branch ON vendor_invoices(branch_id);
CREATE INDEX idx_vendor_invoice_status ON vendor_invoices(payment_status);

CREATE TABLE vendor_invoice_audit (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_invoice_id UUID NOT NULL REFERENCES vendor_invoices(id),
    action            VARCHAR(30) NOT NULL
        CHECK (action IN ('created', 'updated', 'payment_marked_paid', 'payment_marked_unpaid', 'voided')),
    field             VARCHAR(30),
    old_value         TEXT,
    new_value         TEXT,
    acted_by          UUID NOT NULL REFERENCES users(id),
    acted_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vendor_invoice_audit_invoice ON vendor_invoice_audit(vendor_invoice_id);

COMMIT;
