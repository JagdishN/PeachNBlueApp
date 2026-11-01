-- Manual migration (2026-11-01) — Payment-safety corrections: cash-payment
-- Internal Server Error fix + Razorpay payment-link verify/resend. Same
-- standing reason as every other file in this folder: this project uses
-- `prisma db push`, not Prisma Migrate, and `prisma db push` has never been
-- runnable from this dev machine. Run this in Supabase's SQL Editor BEFORE
-- deploying the matching code — and only AFTER the six migrations that
-- precede it in this same folder, in this order:
--   1. 2026-10-30_rename_whatsapp_number_add_secondary.sql
--   2. 2026-10-30_payment_safety_rework.sql
--   3. 2026-10-30_outstanding_dues_rework.sql
--   4. 2026-10-30_admin_override_vendor_invoices.sql
--   5. 2026-10-31_webhook_historical_link_resolution.sql
--   6. 2026-10-31_payment_collection_customer_advances.sql
--   7. this file
--
-- IMPORTANT ORDERING: deploying the backend code that references these new
-- exception_type values (orderService.ts::recordPayment's error boundary,
-- paymentLinkLifecycle.ts's "new link creation failed" branch,
-- paymentLinkConsistency.ts's hourly sweep) BEFORE this migration is
-- applied will cause a live CHECK-constraint violation the first time any
-- of that code tries to insert one of the two new values. Apply this
-- migration first, deploy the code second.
--
-- What this does:
--   payment_reconciliation_exceptions.exception_type's CHECK constraint is
--   extended with two new values:
--     - 'link_creation_failed' — a Razorpay payment-link cancel/replace
--       attempt failed (either detected cleanly inside retireOrReplaceLink,
--       or the call to it threw before it could record its own failure).
--     - 'payment_link_inconsistent' — the hourly consistency sweep found an
--       invoice whose payment-link state doesn't match its outstanding
--       balance (no valid link while money is still owed, a stale link
--       still live on a fully-settled invoice, or an active link's amount
--       not matching the current outstanding balance).
--
-- Verified by inspection only — NOT run against the live database, same
-- caveat as every prior manual migration in this folder. Do not execute
-- without explicit approval.

BEGIN;

ALTER TABLE payment_reconciliation_exceptions
    DROP CONSTRAINT payment_reconciliation_exceptions_exception_type_check;
ALTER TABLE payment_reconciliation_exceptions
    ADD CONSTRAINT payment_reconciliation_exceptions_exception_type_check
    CHECK (exception_type IN (
        'overpayment', 'duplicate_utr', 'cancellation_uncertain',
        'monthly_billing_anomaly', 'unapplied_cash_pending_review',
        'link_creation_failed', 'payment_link_inconsistent'
    ));

COMMIT;
