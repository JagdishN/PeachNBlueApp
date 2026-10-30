-- Manual migration (2026-10-30) — this project uses `prisma db push`, not
-- Prisma Migrate (no migrations/ folder exists), so schema changes beyond a
-- plain additive column need to be applied by hand. Run this in Supabase's
-- SQL Editor BEFORE deploying the matching code change (schema.prisma +
-- backend + mobile), so the live app is never briefly out of sync with the
-- DB mid-deploy.
--
-- What this does, per client request:
--   1. Renames customers.whatsapp_number -> customers.alternative_phone_number
--      (preserves any existing values — a rename, not a drop+recreate).
--   2. Adds a new customers.secondary_phone_number column (nullable).
--
-- After running this, every customer-facing WhatsApp notification fans out
-- to up to three numbers: phone_number (required, unchanged), plus
-- alternative_phone_number and secondary_phone_number (both optional) — see
-- src/services/notificationService.ts's sendNotification.

ALTER TABLE customers RENAME COLUMN whatsapp_number TO alternative_phone_number;
ALTER TABLE customers ADD COLUMN secondary_phone_number VARCHAR(15);
