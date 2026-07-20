# Peach & Blue — Project Context for Claude Code

This file exists so decisions made during planning don't get silently re-litigated or drifted from during implementation. Read this before making architectural or scope decisions. Full detail lives in `/docs` (Technical Design Document, Planning Pack v2, `database_schema_v3.sql`).

---

## What this app is

A staff + admin operations app for a hyperlocal laundry/ironing business (Peach & Blue), branded but built and maintained by NIVENXA. React Native, Android + iOS, single codebase, two role-based views.

**There is no customer-facing app.** Customers contact the business only by phone call or WhatsApp, and receive all updates (pickup confirmation, amount revisions, delivery confirmation, receipts, monthly statements, reminders) via WhatsApp and SMS — never through an app UI. Do not build customer login, customer screens, or a customer API surface unless this changes.

---

## Non-negotiables

- **NIVENXA branding is permanent and hardcoded**: "Powered by NIVENXA" on splash screen (2 seconds, every app open), subtle footer on all screens, "Technology by NIVENXA" on the About page. Not removable without a code change, not theme-able, not tied to the Peach & Blue color scheme.
- **WhatsApp and SMS are always sent together** on every customer notification. This is not a fallback pair (don't build "try WhatsApp, fall back to SMS on failure" logic) — both channels fire independently for every message.
- **Amount revisions require a mandatory reason.** When admin changes `final_amount` from `estimated_amount`, the reason is not optional — it's the same text sent to the customer, so there's no separate internal-note field to keep in sync.
- **Staff have read-only access to the garment catalogue.** Only admin can create/edit/delete garment types and prices.

---

## Roles

- **Staff**: creates orders after physically collecting garments (order does NOT exist before pickup), updates internal status, marks payment collected, views own daily earnings. Scoped to one branch (`users.branch_id`) — the branch whose WhatsApp/phone line they monitor.
- **Admin**: full CRUD on garment catalogue, branches, and staff accounts; can revise order amounts before delivery; manages the monthly billing ledger, aging report, and revenue reports. Can be scoped to one branch (a branch manager) or unscoped (`branch_id = NULL`) to see all branches — build admin views to respect this scope.

---

## Branches (not "buildings")

A branch is generic: it can be an apartment complex or an area/locality (`branch_type`: `'apartment' | 'area'`). Each branch has its **own phone number and WhatsApp number** — this is the number printed on that branch's marketing/bags and the number customers actually message. Don't assume one phone number for the whole business.

Customers reference a branch (`customers.branch_id`) and a `location_label` (free text — a flat number like "A-304" for an apartment branch, or a house/shop identifier for an area branch). Don't reintroduce a flat-number-only field.

**First branch, created in the live DB:**
```json
{
  "branchName": "Attapur",
  "branchType": "area",
  "phoneNumber": "+919398125151",
  "whatsappNumber": "+919398125151",
  "address": "Attapur, Hyderabad",
  "city": "Hyderabad – 500048"
}
```
`address` is a placeholder ("Attapur, Hyderabad" only) — client said to expect a fuller street address later, update this row when it arrives rather than adding a second branch.

---

## Order workflow (confirmed, updated with client's detailed process confirmation)

1. Customer requests pickup via phone call or WhatsApp — same-day or a scheduled date/time slot.
2. Staff physically visits, collects clothes, categorizes items by garment type from the admin-managed catalogue.
3. System auto-calculates an **estimated amount** from the rate master.
4. **The customer instantly receives a PDF invoice at pickup** — not at delivery. Contains order details, a QR code, and a payment link supporting Card and Net/Online Banking. **This is a confirmed change from the original design** (which generated the invoice on delivery) — invoice generation must trigger on order creation, not on the delivered status transition.
5. Order status becomes **Picked/Pending** (this is the only pre-delivery status the customer sees). Internally, staff/admin can track finer sub-stages — keep `internal_status` separate from the customer-facing status; derive the customer-facing label in application code rather than storing it as a second column that can drift out of sync.
6. **Before delivery, admin may revise the final amount.** If revised: log old amount, new amount, reason, and who changed it (`order_amount_revisions`), and send the customer a WhatsApp + SMS message with the revised amount and the reason.
7. At delivery, the executive **verifies payment status** and marks the order both **Delivered** and **Payment Received**. Supported payment modes, confirmed as four distinct types: **Cash, UPI, Net Banking, Credit Card** — `paymentMethod` needs to support all four distinctly, not the earlier two-value `qr_online | cash`.
8. Customer/order/payment/delivery data is kept **separately per flat** (already the design — `Customer.locationLabel` + `branchId` — confirmed correct, no change needed).

**Not in scope right now**: discounts/coupons and monthly billing (client explicitly confirmed **daily payments only, currently** — the ledger/monthly-billing system stays in the schema for a future release but must not be reachable in the UI yet). Staff auto-assignment/dispatch still not needed at 1–2 staff per branch.

**Future feature, confirmed by client**: monthly plans and discounts will likely be introduced later, and must be **visible/manageable only by Admins** when they are. Don't build this now — just don't design anything that would make adding it later harder.

---

## Branding

- Peach/coral primary: `#F2764A` (backgrounds, accents, buttons)
- Navy: `#16305C` (text — especially pricing, per client's explicit direction — and headers)
- These hex values were read off client-provided artwork (a branded pickup bag), not an official brand guide — **replace with exact values once the client sends the logo source file (SVG/AI)**, still outstanding as of this writing.
- Tagline: "Fresh. Clean. Perfectly cared for."

---

## Services — RESOLVED (confirmed twice now, consistent)

Client's explicit process description confirms **three services: Ironing, Dry Cleaning, Wash & Fold.** Pickup & Delivery is doorstep logistics, not a billable service type.

`garment_catalogue.serviceType` is a plain string (not a hard DB enum, deliberately) — seed values: `wash_fold`, `ironing`, `dry_clean`. The earlier 4th tag (`specialty_care`) has been folded into `dry_clean` — that's how delicate items are operationally handled anyway.

**Both data points flagged earlier are now resolved:**
- "Suit (2-Piece)" and "Suit (3-Piece)" (from the FIRST price list) are confirmed as intentionally distinct items, not a typo.
- "Designer Dress" (from the FIRST price list) is a **fixed ₹100**, not a range.

---

## ⚠️ Major pricing model update — replaces the earlier catalogue entirely

The client sent a second, much more comprehensive rate card (`garments-seed-data-v2.json`, 106 items) that **structurally supersedes** the first price list, not just adds to it. This needs real schema changes, not just new seed rows:

1. **A brand-new per-KG bulk pricing tier** ("Laundry Services (Per KG)": Wash & Fold ₹125/kg, Wash & Steam Iron ₹150/kg, Premium Laundry ₹200/kg) with a **5kg minimum charge per order**. `GarmentCatalogue` needs a `pricingUnit` field (`per_piece | per_kg`), and `OrderItem` needs to support a weight-based line (`weightKg` + price-per-kg) alongside the existing piece-based line (`quantity` + `unitPrice`) — an order can plausibly mix both (loose clothes by weight + a saree by the piece). The 5kg minimum is an **order-level** rule, not per-item: if any per-kg items are in the order, total weight across them is charged at a minimum of 5kg even if the actual weight is less.

2. **"Onwards" pricing** on several items (Door Mat, Towel, Sofa Cover, Carpet, Hand Bag, Trolley Bag, Helmet, Shoes, Blanket in the Wash & Iron tier) — a **floor price**, not a fixed one, and not a min/max range like the earlier Designer Dress case. Needs an `isStartingPrice` flag on `GarmentCatalogue`; when true, staff enters the actual final price at pickup with only a minimum-price validation (must be ≥ `price`), no upper bound.

3. **A brand-new Accessories category** (bags, shoes, helmets — not garments). Tagged `dry_clean` as the closest operational fit in the seed data, but this is a judgment call, not a client confirmation — worth checking whether accessories should get their own service type given they're not clothing at all.

4. **"Premium Laundry" (per-KG tier) doesn't map cleanly to the confirmed 3-service list** (Ironing/Dry Cleaning/Wash & Fold). Tagged as `dry_clean` in the seed data as the closest fit — **flagged, not resolved**, needs a client answer.

5. **Same garment name can now legitimately appear at two different prices** — e.g. "Men's Shirt" is ₹129 in the Dry Cleaning tier and ₹49 in the Wash & Iron tier. This is intentional (same item, different service level), not a duplicate — the existing per-`serviceType` row-per-combination model already handles this correctly, just needed to make it explicit here so nobody "deduplicates" it by mistake.

**Two data anomalies transcribed as-is, not silently corrected — need client confirmation:**
- Suit (2 Piece) is priced at ₹999, *higher* than Suit (3 Piece) at ₹549 — reads backwards, likely a swap in the client's price list.
- The Women's Wear section's footer caption and the Men's Wear section's footer caption appear swapped (each references the other's category).

**Also worth reconciling, not urgent**: this new card says "FREE LAUNDRY BAG FOR EVERY CUSTOMER," while the earlier confirmed policy was "first bag free for every *new* customer" plus a ₹350 lost/damaged fee. Could be wording simplification or an actual policy change — worth asking.

See the Claude Code prompts for the actual migration/implementation sequence — this is too structurally significant to hand off as a single prompt.

---

## Admin accounts (confirmed by client, created in the live DB)

Two admin accounts, plus one internal test account — all created as `User` rows with `role: admin`, `branchId` scoped to the Attapur branch (client confirmed this scoping; not unscoped `null` as originally assumed — revisit if a second branch is added and these should become unscoped instead):
- `+919885025151` — internal `fullName`: "PeachandBlue (Admin 1)"
- `+919395389886` — internal `fullName`: "PeachandBlue (Admin 2)"
- `+919949300888` — internal `fullName`: "Jagdish" — **internal test account, delete before deployment.** Assumed `admin` role since it was grouped with the two real admin accounts; flag if `staff` was actually intended.

Phone numbers are stored **without spaces, with the `+91` prefix** (`+919885025151`, not "+91 98850 25151") — matches exactly what `mobile/src/screens/shared/LoginScreen.tsx` sends (`COUNTRY_CODE + localNumber`, no formatting), since `authController.ts` does a plain exact-string lookup with no normalization. Any future account creation (admin UI, scripts) must follow this same format or login will silently fail to match.

**Resolved: no hard technical limit on staff per branch.** Client's "one or two authorized pickup persons per branch" note is an operational policy admin follows manually through normal staff management — the app must NOT block creating a 3rd (or more) staff account for a branch. Keep this generic and admin-controlled, not system-enforced.

**Resolved: admin display naming.** Both admin accounts are labeled identically ("PeachandBlue") by the client, with a distinguishing suffix added only for internal/DB purposes. Rule: **general UI shows the clean name ("PeachandBlue") with the "(Admin N)" suffix stripped; contexts where distinguishing which admin acted actually matters (audit trails — order_amount_revisions.revisedBy, payments.recordedBy, order_status_history.changedBy) should still resolve to a distinguishable identifier** (e.g. phone number or the internal fullName with suffix), since collapsing those to an identical display name would make the audit trail useless. Add a `displayName` field (or equivalent derivation) separate from `fullName` rather than overloading one field for both purposes.

---

## New business rules to build — not yet in the schema

- **Laundry bag tracking**: first bag free per new customer; ₹350 charged if lost/damaged. Needs a `bagIssued` / `bagIssuedAt` flag on `Customer` and a way to charge the ₹350 replacement fee as a distinct line item (not a garment charge) — see Claude Code prompts.
- **30-day pilot program** (per apartment branch): free registration, free bag, introductory pricing, dedicated pickup schedule, continues post-pilot based on satisfaction. Not yet modeled — flagged for a design decision, not assumed.
- **Turnaround time (24–48 hours)** — informational, worth including in the pickup confirmation WhatsApp/SMS message text.
- **Payment link generation** (Razorpay Payment Links, not just a static QR) — supporting Card and Net Banking specifically, delivered instantly at pickup per the confirmed invoice timing above.

---

## Per-flat discounts — RESOLVED

- Discount is a **persistent percentage tied to a flat/customer** (`Customer.discountPercent`), not a per-order coupon. Admin sets/edits it per flat, via an admin-only endpoint separate from the staff-usable customer creation flow.
- **Must not be visible to staff** — enforced at the API response level (never included in any response a staff-role token receives), not just hidden in the mobile UI.
- Shown on the billing document as: subtotal → discount line with the % → **"Amount to be paid"**.

**Resolved: invoice timing.** When admin applies or changes a discount for a customer with an order that already has an invoice out (sent at pickup) and isn't yet delivered/paid, **a new invoice is generated and sent** reflecting the updated amount — this supersedes the original.

**This same "reissue the invoice" mechanism also applies to manual amount revisions** (`order_amount_revisions`), closing a gap that existed before this conversation: previously, an admin amount revision sent a WhatsApp/SMS *notice* but didn't necessarily regenerate the invoice's payment-link amount — meaning a customer could still pay the stale (pre-revision) amount via the original link. Both triggers (discount applied, amount manually revised) should call the **same shared invoice-reissue function**, not two separate implementations:

1. Recalculate the order's payable amount (final amount, minus discount if any).
2. Generate a new invoice PDF + new Razorpay payment link.
3. **Cancel/expire the old payment link** if the Razorpay API supports it — this is the part that actually prevents a double-payment or stale-amount-payment risk, not just cosmetic reissuing.
4. Send the new invoice via WhatsApp + SMS (both channels, as always).
5. Log the reissue event (extend `communications_log`'s `message_type` enum with an `invoice_reissued` value, or similar) so there's a record of every version sent, not just the latest.

See Claude Code prompts for implementation.

**Architecture decision, resolved: staff-hidden fields use TWO layers, not one.**
1. **Primary**: role-aware Prisma `select`/`omit` at each query site that fetches `Customer` data reachable by staff (a shared `customerSelectForRole(role)` helper, not per-endpoint duplication) — the sensitive field never enters memory for a staff-authenticated request in the first place.
2. **Secondary (safety net, not the primary defense)**: a global response-shaping middleware that strips a **centralized, named list** of staff-hidden fields (`STAFF_HIDDEN_FIELDS`, not a hardcoded string) from any response body reaching a staff-role request, catching anything a future endpoint forgets to exclude at the query level.

This list of staff-hidden fields will grow — `discountPercent` is the first entry, and CLAUDE.md's other flagged future-feature ("monthly plans and discounts, admin-only") implies more admin-only financial fields are coming. Treat `STAFF_HIDDEN_FIELDS` as the one place that list lives, referenced by both layers.

If layer 2 (middleware) is implemented, it must specifically handle: Prisma `Decimal`/`Date` instances without breaking, any response path that bypasses `res.json()` (e.g. manual `res.send(JSON.stringify(...))`), and must be the outermost response wrapper relative to any logging/audit middleware — otherwise sensitive data can leak into logs even while the HTTP response itself is clean.

**Implemented.** `src/constants/staffHiddenFields.ts` (`STAFF_HIDDEN_FIELDS`, currently `['discountPercent']`) is the single source of truth for both layers. Primary: `src/utils/roleAwareSelect.ts`'s `customerSelectForRole(role)`, used by `orderService.ts`'s `createOrder`/`listOrders`/`getOrder`/`updateStatus` — the four staff-reachable query sites that include `Customer` data (`reviseAmount`'s two `customer: true` sites are admin-only by route gating, left as-is). Secondary: `src/middleware/staffFieldFilter.ts`, registered in `server.ts` immediately after `express.json()`, before every route. Audited for `res.send()`/manual `JSON.stringify()` bypass risk — none found; the only `JSON.stringify()` in the codebase is `pushService.ts`'s outbound FCM request body, unrelated. No request/response logger exists yet — whoever adds one must register it after `staffFieldFilter` in `server.ts`, not before. Tests: `src/__tests__/orderService.test.ts` (query-construction-level assertions that `discountPercent` is never in the Prisma `select` for staff) and `src/__tests__/staffFieldFilter.test.ts` (nested/array stripping, Decimal/Date handling, admin passthrough).

---

## Tech stack decisions

- Backend: Node.js + Express, **TypeScript** (financial/ledger calculations benefit from compile-time type safety)
- ORM: **Prisma**, schema translated from `database_schema_v3.sql`
- Database: PostgreSQL on Supabase (already provisioned). `schema.prisma` model/field names are camelCase but map (`@@map`/`@map`) onto the live database's snake_case tables — the live DB is the source of truth for table/column naming, not the Prisma model names. Enum-like fields (status, role, payment method, etc.) are plain `String` columns with a Postgres `CHECK` constraint, not native Prisma `enum` types — see "Database sync status" below and `src/types/enums.ts` for the corresponding TS unions.
- Mobile: React Native — **Expo recommended** (simpler setup, EAS Build solves iOS builds without needing a Mac) unless a native module (check Razorpay's RN SDK) needs bare RN
- Payments: Razorpay, QR-code based (no in-app checkout — there's no customer app to check out in)
- Messaging: WhatsApp Business API or Twilio, plus SMS — both sent together, always
- PDF generation: Puppeteer or React-PDF, run as a background job, never inline with the request that completes an order
- Push notifications: Firebase Cloud Messaging (staff/admin devices only)

---

## Database sync status (confirmed against live Supabase)

- `schema.prisma` has been reconciled against the live database via introspection: every model has `@@map`, every field that differs from its DB column gets `@map`, and every enum-like field is `String @db.VarChar(n)` (matching the DB's varchar+CHECK design) instead of a Prisma `enum` — Prisma enums always force a native Postgres enum type on push, which would have diverged from `database_schema_v3.sql`. TS-side type safety for these fields lives in `src/types/enums.ts`.
- The pricing-model columns from "Major pricing model update" (`pricingUnit`, `category`, `isStartingPrice`, `priceMax`, `OrderItem.weightKg`/`pricePerKg`) plus the `device_tokens` and `additional_charges` tables have been pushed to the live DB (`npx prisma db push`).
- **Two CHECK constraints were found stale and corrected** to match what this file already documented as resolved: `garment_catalogue_service_type_check` (was `laundry|iron|both`, now `wash_fold|ironing|dry_clean`) and `orders_payment_method_check` / `payments_payment_method_check` (was `qr_online|cash`, now `cash|upi|net_banking|credit_card` per the order workflow section above). Prisma doesn't manage CHECK constraints — any future enum-like value set change needs a manual `ALTER TABLE ... DROP/ADD CONSTRAINT`, not just a schema.prisma edit.
- The 106-item v2 garment catalogue (`garments-seed-data-v2.json`) has been seeded into the live DB — 106 active rows confirmed. The seed script matches existing rows by `(itemName, category)`, not `itemName` alone — 18 items intentionally share a name across categories at different prices (see "Major pricing model update" point 5); matching on `itemName` alone silently collapses those into one row.
- `Customer.discountPercent` (Decimal, nullable, default 0) has been pushed live, with a `customers_discount_percent_check` CHECK constraint enforcing 0–100. `PATCH /api/v1/customers/:id/discount` (admin-only) is live in `src/controllers/customerController.ts` / `src/routes/customers.ts`.
- Application tables (customers, orders, payments, etc.) are still empty except for `branches` (1 row: Attapur) and `users` (3 rows: the admin/test accounts above) — no order/customer/payment data exists yet, so schema changes there still carry no data-loss risk. This won't be true indefinitely.

---

## Security baseline

- Auth: phone + OTP, short-lived JWT + refresh token, no passwords
- Role-based access enforced server-side (not just hidden in the UI) — a staff-role token must be rejected on admin-only endpoints
- Branch-scoped admin filtering happens at the API layer
- Rate-limit OTP requests per phone number; short OTP expiry
- All secrets in environment variables / hosting platform's secret manager — never committed, never in chat, never in this file
- Parameterized queries throughout (Prisma handles this by default — don't drop to raw SQL without care)
- India's DPDP Act: reasonable security safeguards are a live obligation now, not deferred to 2027 — see Technical Design Document Section 6.3

---

## Still open — do not assume, ask before building

- Final logo source file (SVG/AI) and exact brand hex values
- Decide how pilot-program introductory pricing should work at the data-model level (see New business rules above) — not yet designed
- App store assets (icon, screenshots) — client-provided or need creation
- Default admin branch-scoping behavior in the UI (single-branch view vs all-branches view as default)

---

## Light/dark mode — CONFIRMED, not yet built

Client has confirmed light/dark mode is required. Not yet implemented: `mobile/src/theme/theme.ts` and every screen's styles are currently hardcoded to one (light) palette. Building this touches every screen — treat as a dedicated implementation pass, not a drive-by change alongside unrelated work.

---

*Full specs: `/docs/PeachBlue_Technical_Design_Document.md`, `/docs/PeachBlue_Laundry_App_Planning_Pack_v2.md`, `/docs/database_schema_v3.sql`.*