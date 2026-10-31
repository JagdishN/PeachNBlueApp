-- Manual migration (2026-10-31) — Webhook historical-link resolution fix.
-- Same standing reason as every other file in this folder: this project
-- uses `prisma db push`, not Prisma Migrate, and `prisma db push` has never
-- been runnable from this dev machine. Run this in Supabase's SQL Editor
-- BEFORE deploying the matching code — and only AFTER the four migrations
-- that precede it in this same folder, in this order:
--   1. 2026-10-30_rename_whatsapp_number_add_secondary.sql
--   2. 2026-10-30_payment_safety_rework.sql
--   3. 2026-10-30_outstanding_dues_rework.sql
--   4. 2026-10-30_admin_override_vendor_invoices.sql
--   5. this file
--
-- What this does:
--   1. Adds an index on payment_link_history.razorpay_payment_link_id —
--      webhookController.ts's new fallback lookup (resolveInvoiceForLink)
--      queries this column directly whenever the active-link lookup on
--      invoices.razorpay_payment_link_id misses (the link was retired —
--      admin waiver, reissue, or a cash/bank_upi settlement that cancelled
--      it). Without this index that fallback query is a full table scan.
--   2. New table unmatched_provider_payments — a durable queue for a
--      verified Razorpay receipt whose payment-link id matches NEITHER an
--      invoice's current link NOR any row in payment_link_history. Should
--      be unreachable in normal operation; exists so a genuinely verified
--      receipt is never silently discarded if it ever is reached.
--
-- Verified by inspection and by `npx prisma generate` (schema validation —
-- no DB connection needed) succeeding against the matching schema.prisma
-- changes; NOT verified by an actual `prisma db push` run or against the
-- live database, same caveat as every prior manual migration in this
-- folder.

BEGIN;

-- 1. Index for the webhook's historical-link fallback lookup -------------

CREATE INDEX idx_link_history_link_id ON payment_link_history(razorpay_payment_link_id);

-- 2. unmatched_provider_payments ------------------------------------------

CREATE TABLE unmatched_provider_payments (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider                 VARCHAR(20) NOT NULL DEFAULT 'razorpay',
    razorpay_payment_id      VARCHAR(100) NOT NULL UNIQUE,
    razorpay_payment_link_id VARCHAR(100),
    amount_paise             BIGINT NOT NULL,
    raw_payload              JSONB NOT NULL,
    status                   VARCHAR(20) NOT NULL DEFAULT 'unresolved'
        CHECK (status IN ('unresolved', 'resolved', 'ignored')),
    resolution_notes         TEXT,
    resolved_by              UUID REFERENCES users(id),
    resolved_at              TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_unmatched_payment_status ON unmatched_provider_payments(status);

COMMIT;
