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

**Partially resolved (2026-07-21):** client confirmed the final logo will be delivered as an **SVG**, with an explicit "no extra fonts" constraint — already satisfied as-is: `mobile/src/theme/theme.ts`'s `fonts` export only uses two families (Lora for headings, Inter for body), nothing extra to add or remove. **Still outstanding**: no actual SVG file was attached to the client's message ("Please check from your end" wasn't accompanied by a file) — still can't extract exact hex values or integrate a real logo asset. Ask the client to actually send the file when it's ready; the placeholder hex values above stay in place until then. **When the file does arrive**: check it doesn't reference live/external fonts — text should be converted to outlines/paths, not left as editable text with a font dependency — client explicitly asked for this check ("no extra fonts using").

---

## Services — RESOLVED (confirmed twice now, consistent)

Client's explicit process description confirms **three services: Ironing, Dry Cleaning, Wash & Fold.** Pickup & Delivery is doorstep logistics, not a billable service type.

`garment_catalogue.serviceType` is a plain string (not a hard DB enum, deliberately) — seed values: `wash_fold`, `ironing`, `dry_clean`. **Superseded (2026-07-21) — see "`requiresSpecialCare` — RESOLVED" below**: the earlier 4th tag (`specialty_care`) was folded into `dry_clean` as a service type; client later clarified special care isn't a service tier at all, it's an orthogonal attribute any garment can have — replaced by a separate `requiresSpecialCare` boolean, not a `serviceType` value.

**Both data points flagged earlier are now resolved:**
- "Suit (2-Piece)" and "Suit (3-Piece)" (from the FIRST price list) are confirmed as intentionally distinct items, not a typo.
- "Designer Dress" (from the FIRST price list) is a **fixed ₹100**, not a range.

---

## ⚠️ Major pricing model update — replaces the earlier catalogue entirely

The client sent a second, much more comprehensive rate card (`garments-seed-data-v2.json`, 106 items) that **structurally supersedes** the first price list, not just adds to it. This needs real schema changes, not just new seed rows:

1. **A brand-new per-KG bulk pricing tier** ("Laundry Services (Per KG)": Wash & Fold ₹125/kg, Wash & Steam Iron ₹150/kg, Premium Laundry ₹200/kg) with a **5kg minimum charge per order**. `GarmentCatalogue` needs a `pricingUnit` field (`per_piece | per_kg`), and `OrderItem` needs to support a weight-based line (`weightKg` + price-per-kg) alongside the existing piece-based line (`quantity` + `unitPrice`) — an order can plausibly mix both (loose clothes by weight + a saree by the piece). The 5kg minimum is an **order-level** rule, not per-item: if any per-kg items are in the order, total weight across them is charged at a minimum of 5kg even if the actual weight is less.

2. **"Onwards" pricing** on several items (Door Mat, Towel, Sofa Cover, Carpet, Hand Bag, Trolley Bag, Helmet, Shoes, Blanket in the Wash & Iron tier) — a **floor price**, not a fixed one, and not a min/max range like the earlier Designer Dress case. Needs an `isStartingPrice` flag on `GarmentCatalogue`; when true, staff enters the actual final price at pickup with only a minimum-price validation (must be ≥ `price`), no upper bound.

3. **Resolved (2026-07-21): Accessories category stays `dry_clean`, confirmed by client** ("whatever currently available please add them in the Accessories Service Mapping" — read as: keep the existing/available service-type tagging, don't introduce a new one for non-garment items). All Accessories rows (Hand Bag, Trolley Bag, Helmet, Shoes, Backpack, Laptop Bag, Leather Shoes, Sandals, Crocs, Slippers) were already `dry_clean` in the seed data — the `_note` flags asking for this confirmation have been removed, no data values changed.

4. **"Premium Laundry" (per-KG tier) doesn't map cleanly to the confirmed 3-service list** (Ironing/Dry Cleaning/Wash & Fold). Tagged as `dry_clean` in the seed data as the closest fit — **still flagged, not resolved** — the client's 2026-07-21 response addressed Accessories specifically, not this one; don't assume it's covered by the same answer without asking.

5. **Same garment name can now legitimately appear at two different prices** — e.g. "Men's Shirt" is ₹129 in the Dry Cleaning tier and ₹49 in the Wash & Iron tier. This is intentional (same item, different service level), not a duplicate — the existing per-`serviceType` row-per-combination model already handles this correctly, just needed to make it explicit here so nobody "deduplicates" it by mistake.

**Resolved (2026-07-21): Suit (2/3 Piece) price swap, confirmed by client** ("the prices appearing in reverse and change it"). Corrected in `garments-seed-data-v2.json` and re-seeded to the live DB: Suit (2 Piece) is now ₹549 (was ₹999), Suit (3 Piece) is now ₹999 (was ₹549) — i.e. reversed from the original transcription, not left as originally listed. Verified against the live `garment_catalogue` table post-seed, and re-verified again on a second pass — both rows hold.

**Resolved (2026-07-20): Women's/Men's Wear footer caption swap was a mistake, confirmed by client.** The Women's Wear section's caption ("And many more men's dresses & winter wear") and the Men's Wear section's caption ("And many more women's dresses & ethnic wear") were swapped in the client's rate card — client confirmed. No application code change needed: these captions were never modeled as data (no field on `GarmentCatalogue`, nothing in the mobile app renders them) — they only existed as a note (`captionSwapNote`) in `garments-seed-data-v2.json`'s `businessInfo`, documenting an anomaly in the client's source PDF. That note has been updated to reflect the resolution.

**Resolved: bag policy.** The laundry bag is free for every customer (not limited to new customers as earlier phrasing implied) — the ₹350 charge only applies if the bag is subsequently lost or damaged. Supersedes the earlier "first bag free for every *new* customer" wording; the ₹350 lost/damaged fee itself is unchanged.

**Implemented — see "Laundry bag tracking — RESOLVED and implemented" below** for the tracking design (single issuance vs. replacement history) and what was actually built.

See the Claude Code prompts for the actual migration/implementation sequence — this is too structurally significant to hand off as a single prompt.

---

## Admin accounts (confirmed by client, created in the live DB)

Two admin accounts, plus one internal test account — all created as `User` rows with `role: admin`. Originally scoped to the Attapur branch; **now updated to unscoped (`branchId = null`)** per the resolved "default admin view is All Branches" decision above (see "Still open"):
- `+919885025151` — internal `fullName`: "PeachandBlue (Admin 1)"
- `+919395389886` — internal `fullName`: "PeachandBlue (Admin 2)"
- `+919949300888` — internal `fullName`: "Jagdish" — **internal test account, delete before deployment.** Assumed `admin` role since it was grouped with the two real admin accounts; flag if `staff` was actually intended.

Phone numbers are stored **without spaces, with the `+91` prefix** (`+919885025151`, not "+91 98850 25151") — matches exactly what `mobile/src/screens/shared/LoginScreen.tsx` sends (`COUNTRY_CODE + localNumber`, no formatting), since `authController.ts` does a plain exact-string lookup with no normalization. Any future account creation (admin UI, scripts) must follow this same format or login will silently fail to match.

**Resolved: no hard technical limit on staff per branch.** Client's "one or two authorized pickup persons per branch" note is an operational policy admin follows manually through normal staff management — the app must NOT block creating a 3rd (or more) staff account for a branch. Keep this generic and admin-controlled, not system-enforced.

**Resolved: admin display naming.** Both admin accounts are labeled identically ("PeachandBlue") by the client, with a distinguishing suffix added only for internal/DB purposes. Rule: **general UI shows the clean name ("PeachandBlue") with the "(Admin N)" suffix stripped; contexts where distinguishing which admin acted actually matters (audit trails — order_amount_revisions.revisedBy, payments.recordedBy, order_status_history.changedBy) should still resolve to a distinguishable identifier** (e.g. phone number or the internal fullName with suffix), since collapsing those to an identical display name would make the audit trail useless. Add a `displayName` field (or equivalent derivation) separate from `fullName` rather than overloading one field for both purposes.

**Implemented.** `mobile/src/utils/displayName.ts`'s `getDisplayName(fullName)` strips a trailing `(...)` suffix via regex — a **derivation, not a stored column**, matching this codebase's existing convention of deriving display values in application code rather than duplicating state that can drift (same reasoning as `internalStatus` vs. the customer-facing status label). Applied at `StaffManagementScreen.tsx`'s account list (the one "general UI" spot that actually renders another user's raw `fullName` — confirmed via a full grep of `.fullName` usages across mobile) and `StaffHomeScreen.tsx`'s own-name greeting (a no-op for staff names, applied for consistency). **Audit-trail contexts remain untouched, correctly**: grepped and confirmed no screen currently renders `order_amount_revisions.revisedBy` / `payments.recordedBy` / `order_status_history.changedBy` at all — there's nothing there yet to strip, so the rule ("keep the full name in audit contexts") has nothing to violate; apply the same derivation logic if/when an audit-trail view gets built, and don't strip there.

---

## New business rules to build — not yet in the schema

- ~~**Laundry bag tracking**: first bag free per new customer; ₹350 charged if lost/damaged.~~ **Implemented — see "Laundry bag tracking — RESOLVED and implemented" below.**
- ~~**30-day pilot program**~~ **Removed from scope (2026-07-21), per client: "Remove 30-day Pilot Program for now."** Confirmed via a full-codebase search (`pilot`/`30-day`/`pilotEndsAt`/`pilotProgram`, case-insensitive, across `src/`, `mobile/src/`, and `backEnd/prisma/schema.prisma`) that there is genuinely zero code to remove — no stub fields, no placeholder UI, no half-finished migration. The only mention anywhere is in `docs/PeachBlue_Technical_Design_Document.md`, a historical planning doc, not application code — left untouched, since this file (CLAUDE.md) is what governs current scope, not that doc.
- **Turnaround time (24–48 hours)** — informational, worth including in the pickup confirmation WhatsApp/SMS message text.
- **Payment link generation** (Razorpay Payment Links, not just a static QR) — supporting Card and Net Banking specifically, delivered instantly at pickup per the confirmed invoice timing above.

---

## Per-flat discounts — RESOLVED

- Discount is a **persistent percentage tied to a flat/customer** (`Customer.discountPercent`), not a per-order coupon. Admin sets/edits it per flat, via an admin-only endpoint separate from the staff-usable customer creation flow.
- **Must not be visible to staff** — enforced at the API response level (never included in any response a staff-role token receives), not just hidden in the mobile UI.
- Shown on the billing document as: subtotal → discount line with the % → **"Amount to be paid"**.

**Re-verified directly against the route table (not just this doc): both controls hold.** `routes/customers.ts` gates `PATCH /:id/discount` and `PATCH /:id/discount-enabled` to `requireRole(['admin'])` — staff gets a 403, confirmed by `src/__tests__/customerController.test.ts`. And it's customer-level only: both fields live on `Customer`, there is no per-order discount field or endpoint anywhere in `schema.prisma`/the controllers.

**Gap found and closed: there was no audit trail for discount changes.** Unlike `order_amount_revisions` (old amount, new amount, reason, who, when — real financial data with a real audit log), `updateDiscountHandler`/`updateDiscountEnabledHandler` just overwrote the customer row directly — no record of who changed a discount or when. **Implemented.** `CustomerDiscountAudit` (new model: `customerId`, `field` — `'discountPercent' | 'discountEnabled'`, `oldValue`/`newValue` as strings since the two fields are differently typed, `changedById`, `changedAt`), pushed live. Both discount handlers now write an audit row alongside the update (before the invoice-reissue call). `GET /api/v1/customers/:id/discount-audit` (admin-only) lists a customer's history, including the changer's name/phone. Not yet surfaced in `CustomerManagementScreen.tsx` — the endpoint exists, no mobile screen calls it yet (same "backend live, UI not built" gap pattern as billingMode/discountEnabled had before their own screen landed).

Tests: `src/__tests__/customerController.test.ts`'s new "PATCH /:id/discount" and "GET /:id/discount-audit" blocks, plus the existing discount-enabled test extended to assert the audit row.

**Resolved: invoice timing.** When admin applies or changes a discount for a customer with an order that already has an invoice out (sent at pickup) and isn't yet delivered/paid, **a new invoice is generated and sent** reflecting the updated amount — this supersedes the original.

**This same "reissue the invoice" mechanism also applies to manual amount revisions** (`order_amount_revisions`), closing a gap that existed before this conversation: previously, an admin amount revision sent a WhatsApp/SMS *notice* but didn't necessarily regenerate the invoice's payment-link amount — meaning a customer could still pay the stale (pre-revision) amount via the original link. Both triggers (discount applied, amount manually revised) should call the **same shared invoice-reissue function**, not two separate implementations:

1. Recalculate the order's payable amount (final amount, minus discount if any).
2. Generate a new invoice PDF + new Razorpay payment link.
3. **Cancel/expire the old payment link** if the Razorpay API supports it — this is the part that actually prevents a double-payment or stale-amount-payment risk, not just cosmetic reissuing.
4. Send the new invoice via WhatsApp + SMS (both channels, as always).
5. Log the reissue event (extend `communications_log`'s `message_type` enum with an `invoice_reissued` value, or similar) so there's a record of every version sent, not just the latest.

**Implemented.** Invoice PDF generation uses `@react-pdf/renderer` (chosen over Puppeteer specifically to avoid bundling Chromium into the backend deployment) rendered in `src/services/invoicePdfService.tsx`, uploaded to a Supabase Storage `invoices` bucket via `src/lib/supabaseStorage.ts` (bucket itself is a one-time manual dashboard setup, not code-managed). Razorpay Payment Links (Card + Net Banking) are created/cancelled via `src/lib/razorpayClient.ts` — the "restrict to Card + Net Banking only" requirement is implemented against Razorpay's documented parameters but **not yet verified against a live sandbox** (no `RAZORPAY_KEY_ID`/`_KEY_SECRET` configured yet — flagged for a real-credentials check).

The five numbered steps above are one shared, idempotent function: `src/services/invoiceService.ts`'s `generateInvoice(orderId)` fetches the order's existing `Invoice` row (if any) and, when present, best-effort cancels its payment link and bumps `Invoice.version` (suffixing `invoiceNumber` with `-R{version}`, e.g. `PB-INV-00042-R2`) rather than maintaining a separate invoice-history table — the version-by-version audit trail lives in `communications_log` instead, per point 5 above. `src/services/invoiceReissue.service.ts`'s `reissueInvoice(orderId)` wraps this with the customer notification (`invoice_reissued`, added to `CommunicationMessageType` and the live `communications_log_message_type_check` constraint), and `reissueAllOpenInvoicesForCustomer(customerId)` is the discount-triggered fan-out, scoped to `internalStatus !== 'delivered' AND paymentStatus !== 'paid'` per this section's "isn't yet delivered/paid" wording. Wired at both call sites: `orderService.ts::reviseAmount` awaits `reissueInvoice` (synchronous admin action — failures should surface, not be swallowed), and `customerController.ts::updateDiscountHandler` awaits `reissueAllOpenInvoicesForCustomer`.

The very first invoice (at pickup, order creation) reuses this exact same `generateInvoice` function — with no prior `Invoice` row, it just creates version 1, no cancellation needed. Per CLAUDE.md's tech-stack decision that PDF generation must run as a background job, never inline with the order-creation request, `orderService.ts::createOrder` calls `generateInvoice` **without awaiting it** — the existing instant `pickup_confirmation` text (order number, estimated amount, turnaround time) still fires synchronously as before; a second `pickup_confirmation` message with the invoice PDF link and payment link follows once generation completes, typically a few seconds later. This is the first genuinely fire-and-forget side effect in the codebase (every other notification call is awaited) — deliberate, not an oversight.

Tests: `src/__tests__/invoiceService.test.ts` (discount-adjusted amount math, fresh-vs-reissue version/invoice-number/cancel behavior), `src/__tests__/invoiceReissue.test.ts` (notification content, delivered/paid order filtering), `src/__tests__/razorpayClient.test.ts` (payment-link creation, best-effort cancel swallowing failures), and `src/__tests__/orderService.test.ts`'s "invoice generation is non-blocking" block (`createOrder` resolves even while/if `generateInvoice` hangs or rejects).

**Not yet done**: end-to-end verification against a real Razorpay sandbox (needs test-mode credentials) and creating the live Supabase Storage `invoices` bucket.

**Architecture decision, resolved: staff-hidden fields use TWO layers, not one.**
1. **Primary**: role-aware Prisma `select`/`omit` at each query site that fetches `Customer` data reachable by staff (a shared `customerSelectForRole(role)` helper, not per-endpoint duplication) — the sensitive field never enters memory for a staff-authenticated request in the first place.
2. **Secondary (safety net, not the primary defense)**: a global response-shaping middleware that strips a **centralized, named list** of staff-hidden fields (`STAFF_HIDDEN_FIELDS`, not a hardcoded string) from any response body reaching a staff-role request, catching anything a future endpoint forgets to exclude at the query level.

This list of staff-hidden fields will grow — `discountPercent` is the first entry, and CLAUDE.md's other flagged future-feature ("monthly plans and discounts, admin-only") implies more admin-only financial fields are coming. Treat `STAFF_HIDDEN_FIELDS` as the one place that list lives, referenced by both layers.

If layer 2 (middleware) is implemented, it must specifically handle: Prisma `Decimal`/`Date` instances without breaking, any response path that bypasses `res.json()` (e.g. manual `res.send(JSON.stringify(...))`), and must be the outermost response wrapper relative to any logging/audit middleware — otherwise sensitive data can leak into logs even while the HTTP response itself is clean.

**Implemented.** `src/constants/staffHiddenFields.ts` (`STAFF_HIDDEN_FIELDS`, currently `['discountPercent']`) is the single source of truth for both layers. Primary: `src/utils/roleAwareSelect.ts`'s `customerSelectForRole(role)`, used by `orderService.ts`'s `createOrder`/`listOrders`/`getOrder`/`updateStatus` — the four staff-reachable query sites that include `Customer` data (`reviseAmount`'s two `customer: true` sites are admin-only by route gating, left as-is). Secondary: `src/middleware/staffFieldFilter.ts`, registered in `server.ts` immediately after `express.json()`, before every route. Audited for `res.send()`/manual `JSON.stringify()` bypass risk — none found; the only `JSON.stringify()` in the codebase is `pushService.ts`'s outbound FCM request body, unrelated. No request/response logger exists yet — whoever adds one must register it after `staffFieldFilter` in `server.ts`, not before. Tests: `src/__tests__/orderService.test.ts` (query-construction-level assertions that `discountPercent` is never in the Prisma `select` for staff) and `src/__tests__/staffFieldFilter.test.ts` (nested/array stripping, Decimal/Date handling, admin passthrough).

**Implemented (2026-07-20).** `discountEnabled` was added to `STAFF_HIDDEN_FIELDS` and `roleAwareSelect.ts`'s field list alongside `discountPercent` — same two-layer treatment, same files.

---

## Monthly billing + discount: now live, per-customer admin toggles, default OFF

Both features go live now (previously "future, not yet built" / "gated, not reachable in UI"). **Both are admin-only to change, both default to off/disabled per customer** — this doesn't change the "daily payments only" baseline, it makes monthly billing and discounts opt-in exceptions an admin deliberately turns on for a specific flat.

**Discount** — add `Customer.discountEnabled` (Boolean, default `false`), separate from the existing `Customer.discountPercent`. Toggling this off should NOT clear the stored percentage — admin can disable a discount temporarily and re-enable it later at the same rate without re-entering it. The invoice/receipt discount line and the invoice-reissue logic (see above) should only apply when `discountEnabled` is true AND `discountPercent > 0`.

**Monthly billing** — this reuses the existing `Customer.billingMode` field (`'daily' | 'monthly_billing'`, already defaults to `'daily'`) rather than adding a redundant boolean. What changes is un-gating it: the mobile UI hiding it (built earlier when this was "not active yet") needs to be reversed, and the admin-only toggle needs to actually be reachable and functional now.

**Correction: there was no mobile-UI gating to reverse.** Checked before building — the "Ledger" tab (`LedgerAgingScreen.tsx`) has been reachable in `AdminTabs.tsx` all along, un-gated. There is also no per-customer management screen anywhere in the mobile app yet (admin or staff) — the existing `PATCH /:id/discount` endpoint from "Per-flat discounts — RESOLVED" above has never had a mobile caller either. So the backend toggles below (`discountEnabled`, `billingMode`) are live and admin-reachable via the API, but **not yet reachable from the app UI** — that's a separate, not-yet-scoped screen-building task, not a gate to flip.

**Critical distinction — these two are NOT equally sensitive, don't apply the same staff-hiding treatment to both:**
- `discountPercent` / `discountEnabled` — **fully hidden from staff**, same treatment as before (query-level exclusion + middleware safety net). Real financial data staff has no operational need to see.
- `billingMode` — **admin-only to change, but staff CAN and MUST see it.** Staff need to know at delivery whether to collect payment now (daily customer) or not (monthly-billing customer — charge goes to the ledger instead, per the existing order/delivery flow). Hiding this from staff would break the actual pickup/delivery workflow. Do not add `billingMode` to `STAFF_HIDDEN_FIELDS`.

**Workflow implication — already implemented, turned out to predate this prompt.** `orderService.ts`'s `updateStatus` already branched on `billingMode` on the `delivered` transition (`if (newStatus === 'delivered' && order.customer.billingMode === 'monthly_billing') await recordCharge(...)`) — this was built during an earlier pass, not new. Verified it still does the right thing and added regression coverage (`src/__tests__/orderService.test.ts`'s "updateStatus — delivery billingMode branch": monthly-billing customer posts a ledger charge on delivery, daily customer doesn't, non-`delivered` transitions don't charge either). Note this charges `order.finalAmount` as-is, not discount-adjusted — same as before this change, left alone since discount-adjusting the ledger charge wasn't asked for here.

**Open question, not yet answered**: does turning monthly billing ON for a customer apply only to orders created from that point forward, or retroactively to any existing unpaid daily orders? Defaulting to **forward-only** (existing orders keep their original payment terms) unless told otherwise — this avoids silently changing payment terms on an order the customer already has a live invoice for.

**Resolved (2026-07-21): toggle-only, confirmed by client** — "Discounts and coupons don't show in the UI, just keep in the Admin if needed he will add them." Confirms the toggle-only interpretation below (not a coupon-code system) AND that this should stay low-profile/admin-only rather than surfaced anywhere broader — which matches what's already built: `discountEnabled`/`discountPercent` are staff-hidden (`STAFF_HIDDEN_FIELDS`) and only reachable through the admin-only `CustomerManagementScreen.tsx`, not exposed on any staff-facing or general screen. No further UI surfacing work needed for this unless the client asks for it later.

**Implemented (2026-07-21): discount controls visually de-emphasized in `CustomerManagementScreen.tsx`**, per the client's framing above ("an occasional, as-needed admin action, not a headline feature"). The Discount toggle/percent field now sit below a subtle divider with a smaller, muted-color sub-heading ("Discount (optional)"), visually secondary to the Billing Mode toggle above it — same fields, same behavior, just not given equal prominence.

**Verified (2026-07-21): no customer-facing coupon-code entry or promotional banner anywhere.** Full-codebase search for `coupon`/`promo` (case-insensitive, across `src/` and `mobile/src/`) returns zero matches — confirms there's nothing to remove and nothing was accidentally built beyond the admin-only toggle. `CustomerManagementScreen.tsx` only imports `fetchCustomers`/`updateCustomerBillingMode`/`updateCustomerDiscountEnabled`/`updateCustomerDiscountPercent` — no coupon-related surface exists, and since there's no customer-facing app at all (see this file's opening section), there's no screen a customer could reach one through regardless.

**Implemented (2026-07-20).** `Customer.discountEnabled` (Boolean, default `false`) added to `schema.prisma` and pushed to the live DB (`npx prisma db push`). Two new admin-only endpoints in `src/controllers/customerController.ts` / `src/routes/customers.ts`: `PATCH /api/v1/customers/:id/discount-enabled` (validates boolean, updates, then calls the existing `reissueAllOpenInvoicesForCustomer` — toggling either direction changes the payable amount on any open invoice) and `PATCH /api/v1/customers/:id/billing-mode` (validates `'daily' | 'monthly_billing'`, updates, no invoice reissue since billing mode doesn't affect amount). `invoiceService.ts`'s `generateInvoice` now gates the discount calc on `order.customer.discountEnabled` (previously applied `discountPercent` unconditionally). Tests: `src/__tests__/invoiceService.test.ts` (discount not applied when `discountEnabled` is false despite a stored percent), `src/__tests__/orderService.test.ts` (role-aware select hides `discountEnabled` from staff/shows to admin, same as `discountPercent`; shows `billingMode` to both roles), `src/__tests__/staffFieldFilter.test.ts` (middleware strips `discountEnabled` too), and a new `src/__tests__/customerController.test.ts` (route-level: staff gets 403 on both new endpoints via `requireRole`, admin succeeds, validation, 404, reissue-triggered-on-either-direction).

**Found and left as-is, not fixed here**: this repo's local `.env` has `JWT_SECRET=` (empty string) — `config/index.ts`'s fallback (`getEnv('JWT_SECRET', 'replace-with-secret')`) only substitutes on `null`/`undefined`, not on an empty string, so it silently resolves to `''` in this dev environment. The startup warning ("using a fallback JWT_SECRET") fires but is misleading — no fallback is actually applied. `jsonwebtoken` rejects an empty secret outright, so any code path that calls `jwt.sign` with this value would throw. The already-running dev server response (401 on an unauthenticated request) suggests this isn't breaking real login today, but it's worth setting a real `JWT_SECRET` value regardless. The new `customerController.test.ts` mocks `../config` locally rather than depending on this value.

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
- The garment catalogue (`garments-seed-data-v2.json`, now v3 in substance — file not renamed) has been seeded into the live DB — **149 active rows confirmed** (106 original + 43 reintroduced Iron Services items, see "Iron-only tier reintroduced" below). The seed script matches existing rows by `(itemName, category)`, not `itemName` alone — several items intentionally share a name across categories at different prices (see "Major pricing model update" point 5); matching on `itemName` alone silently collapses those into one row.
- `GarmentCatalogue.requiresSpecialCare` (Boolean, default `false`) pushed live (`npx prisma db push`) — see "`requiresSpecialCare` — RESOLVED" below. 13 rows confirmed `true` post-seed.
- `Customer.discountPercent` (Decimal, nullable, default 0) has been pushed live, with a `customers_discount_percent_check` CHECK constraint enforcing 0–100. `PATCH /api/v1/customers/:id/discount` (admin-only) is live in `src/controllers/customerController.ts` / `src/routes/customers.ts`.
- `Customer.discountEnabled` (Boolean, default `false`) has been pushed live (`npx prisma db push`) — see "Monthly billing + discount: now live" below. `npx prisma generate`'s Prisma Client type/JS output regenerated successfully (confirmed present in `node_modules/.prisma/client/index.d.ts`); its native `query_engine-windows.dll.node` binary specifically failed to rewrite (`EPERM`, file held open by the already-running dev server process — traced to an untraceable-by-PID handle, not a stray process this session started) — harmless, since the engine binary version didn't change and doesn't encode model-specific fields; only the generated JS/TS (which did update) does.
- Application tables (customers, orders, payments, etc.) are still empty except for `branches` (1 row: Attapur) and `users` (3 rows: the admin/test accounts above) — no order/customer/payment data exists yet, so schema changes there still carry no data-loss risk. This won't be true indefinitely.
- `GarmentCatalogue.iconKey` (`String?`) pushed live (`npx prisma db push`) — see "Icons for garment types" below. The catalogue was reseeded against an updated `garments-seed-data-v2.json` (43 new "Wash" rows added — see "New \"Wash\" service" below) — **192 active rows confirmed** (149 + 43), up from the 149 documented earlier in this file.
- `CustomerDiscountAudit` (new model — see "Per-flat discounts" above) pushed live. The existing `Payment` table (previously modeled but never written to by any code — confirmed via grep, zero `prisma.payment.create` calls anywhere) is now actually used by `orderService.ts::recordPayment` — see "Payment marking" below.

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

## Twilio trial mode — real constraints, not just a config detail

**Now true (2026-07-21): real trial-tier credentials added to `.env`.** WhatsApp/SMS sending was already fully implemented in code (`src/lib/twilioClient.ts`, `src/services/notificationService.ts`, `src/services/otpService.ts`) from an earlier pass — the only gap was missing real credentials, now filled in. **No new client/job/util files were created** — a prompt describing this as new work (`src/utils/twilioClient.ts`, `src/jobs/notifications.job.ts`, `src/utils/otp.ts`, stub `sendWhatsApp`/`sendSms` functions to replace) didn't match this codebase's actual structure; the real files are `src/lib/twilioClient.ts` (already real Twilio SDK calls, not stubs) and `src/services/otpService.ts`'s `sendOtpViaChannels` (already wired into `authController.ts::requestOtp`).

One correction to the credential values as originally provided: `TWILIO_WHATSAPP_FROM` must be the **bare number**, no `whatsapp:` prefix — `twilioClient.ts` already prepends that itself (`` `whatsapp:${TWILIO_WHATSAPP_FROM}` ``). Setting the env var to `whatsapp:+14155238886` (as first given) would have doubled the prefix and broken every outbound WhatsApp send; set to `+14155238886` instead.

**Tested (2026-07-21) via a direct call to `sendSms`/`sendWhatsApp`** (not the full `/api/auth/request-otp` endpoint — the currently-running dev server's Redis-backed OTP rate-limiting has no local Redis instance to connect to right now, a separate pre-existing gap, unrelated to Twilio; see "Redis setup" in the README):
- **SMS to +919949300888 failed**: Twilio error 21608, "unverified number" — this phone number is not yet verified in the Twilio Console's Verified Caller IDs. Expected trial-mode behavior, not a bug — verify it there if you want to test SMS with this number.
- **WhatsApp to +919949300888: Twilio accepted the request** (API call succeeded) — this confirms the number has joined the Sandbox, OR at minimum that Twilio's API didn't reject it outright. API acceptance doesn't guarantee the message was actually delivered/received — please confirm on your end whether it actually arrived in WhatsApp.

Improved error surfacing per this integration: `src/lib/twilioClient.ts` now exports `formatTwilioError(err)`, extracting Twilio's specific `code`/`message`/`moreInfo` (e.g. "Twilio error 21608: ...") instead of a raw error object dump — used by both `notificationService.ts` and `otpService.ts`'s rejection logging. Test: `src/__tests__/twilioClient.test.ts`.

Two real limitations apply on the trial tier, both matter for testing expectations:

- **SMS** only reaches phone numbers manually verified in the Twilio Console (Console → Phone Numbers → Verified Caller IDs). Cannot reach arbitrary real customer numbers yet.
- **WhatsApp** uses Twilio's **Sandbox**, not real production WhatsApp Business messaging — this is separate from the Meta WhatsApp Business API approval process already documented in the Technical Design Document's Section 9. Recipients must first text a join code to Twilio's sandbox number before they can receive anything.

**"Client sets up pro" is two separate upgrades, not one**: (1) Twilio billing upgrade (removes trial SMS restrictions/prefix), and (2) WhatsApp Business API production approval through Meta (separate process, 1–3 weeks, doesn't happen automatically from the Twilio billing upgrade alone). Don't conflate these when talking to the client about timeline.

---

## `requiresSpecialCare` — RESOLVED, replaces the earlier `specialty_care` service type

Client confirmed: "special care" is **not a service tier**, it's an attribute any garment can have regardless of which tier it's priced under (a silk saree could be dry-cleaned AND need special handling; a wool coat could be on the wash & iron tier and still need care). This replaces the earlier decision to fold `specialty_care` into `dry_clean` as a service type (see the now-corrected note in "Services — RESOLVED" above).

**Implemented (2026-07-21).** `GarmentCatalogue.requiresSpecialCare` (Boolean, default `false`), independent of `serviceType` — added to `schema.prisma`, pushed to the live DB (`npx prisma db push`). `backEnd/prisma/seed.ts`'s `SeedGarment` interface and upsert `data` object both updated to read/persist it (previously would have silently dropped the field even once present in the seed JSON). Seed data sets this `true` by default on curtains, bridal dupatta, sofa cover, carpet, and everything in the Delicate & Premium Wear category — sensible defaults, not locked values. Verified against the live DB post-seed: 13 rows with `requiresSpecialCare: true`, 136 with `false` (149 total, see "Iron-only tier reintroduced" below for why the total isn't 106 anymore).

**Known gap, since closed (see below).** ~~The admin Garment Catalogue screen's create/update flow only handles itemName/price/serviceType~~ — was true when this note was written, no longer true.

**Implemented.** `garmentController.ts`'s `createGarmentHandler`/`updateGarmentHandler` now accept and validate `category`, `pricingUnit` (`'per_piece' | 'per_kg'`), `priceMax` (must be ≥ `price` when set), `isStartingPrice`, and `requiresSpecialCare` — a shared `validatePricingFields` helper runs the same checks for both handlers. `mobile/src/screens/admin/GarmentCatalogueScreen.tsx`'s add/edit modal gained fields for all five: a Category text input, a Pricing Unit toggle (Per Piece / Per KG), a Price Max text input (optional, range-priced items), a Starting Price Yes/No toggle, alongside the existing Requires Special Care toggle. The catalogue card also now shows `category` as a muted subtitle and small "Priced per kg"/"Starting price (onwards)" hints when applicable. Tests: `src/__tests__/garmentController.test.ts` (new file — role gate, all five fields pass through to the Prisma `create`/`update` call, `pricingUnit` value validation, `priceMax`/price ordering validation, boolean validation on `isStartingPrice`/`requiresSpecialCare`).

---

## Iron-only tier reintroduced — RESOLVED, all 5 sections confirmed

The client's original first price chart (Women's Wear / Home Linen / "Iron Services" banner over Men's & Kids Wear / Delicate & Premium Wear) was previously treated as fully superseded when the second, larger rate card came in. **That was wrong** — it represents a genuine standalone **iron-only tier** (no wash component), which was missing: the v2 catalogue's "Wash & Iron (Per Piece)" tier is a wash+iron *combo*, and there was no price for a customer who says "I already washed it, just iron it." Reintroduced as 43 items, `serviceType: ironing`, `pricingUnit: per_piece`, category prefix `"Iron Services — "`.

**RESOLVED: client confirmed all 5 sections are genuinely iron-only** — Women's Wear, Men's Wear, Kids Wear, Delicate & Premium Wear, and Home Linen, not just the two (Men's/Kids) that carried the literal "IRON SERVICES" banner in the artwork. Nothing here is still open.

**Two items in this reintroduced data were already resolved in earlier rounds and were NOT reopened**: Suit (2-Piece)/(3-Piece) from this chart (₹120/₹150 — a different, separate occurrence from the ₹999/₹549 inversion found later in the v2 Dry Cleaning tier), and Designer Dress (fixed ₹100, not the ₹80–150 range shown on this chart). Both verified against the live DB post-seed and hold as expected.

**Implemented and seeded (2026-07-21).** All 43 items confirmed live: `garment_catalogue` now has 149 active rows total (106 original + 43 Iron Services), verified directly against the DB post-seed (`Iron Services —` category count = 43, exact match).

**Checked (2026-07-21): the "three near-identical Shirt entries" navigability concern raised above.** Read `NewOrderEntryScreen.tsx`'s actual rendering — garments group by `category` (`groupedGarments`, a `Map` keyed on the category string) with a bold uppercase `categoryHeader` per section; the three "Shirt" occurrences for Men's Wear are never ambiguous in practice: "Shirt (Cotton)" sits under "MEN'S WEAR (DRY CLEANING)" (₹129), "Men's Shirt" sits under "WASH & IRON (PER PIECE)" (₹49), and "Shirt" sits under "IRON SERVICES — MEN'S WEAR" (₹14) — three different item-name strings, three different clearly-labeled sections, never rendered adjacent to each other without a header boundary between them. **The grouping does scale correctly for disambiguation** — no code change needed there. The real consequence of this data update is list **length**, not clarity: the catalogue grew from 106 to 149 items across several new large category sections, with no search/filter in this screen — scrolling to find a specific item during a live pickup will take noticeably longer than before. Worth a search/filter affordance if that becomes a real complaint from staff using it; not built, since it wasn't asked for and isn't a correctness issue.

---

## Garment picker restructuring — service-type as parent, Ironing default-expanded — IMPLEMENTED

Client wants the New Order Entry garment picker restructured: **service type is the top-level, expandable parent** (Iron, Wash, Dry Clean, etc.) — selecting/expanding a service type reveals the garments under it, rather than the current category-grouped flat list. **Ironing is the default-expanded/selected service** when the screen loads, not a neutral/empty state requiring staff to pick a service type first every time.

**Implemented.** `NewOrderEntryScreen.tsx`'s `groupedByService` now groups garments by `serviceType` first (fixed display order `['ironing', 'wash_fold', 'dry_clean']`, with any future serviceType not in that list appended alphabetically rather than silently dropped), then nests the existing `category` grouping underneath each service — the category-level rendering itself is unchanged. Each service-type section is an expand/collapse header (`expandedServices` state, chevron icon), defaulting to `{ ironing: true }` so Ironing is open on load and everything else starts collapsed.

**Search/filter — since implemented, closing the gap "Iron-only tier reintroduced" flagged above.** A text field above the picker filters by `itemName` (substring, case-insensitive) — the thing staff actually knows the customer said, not category/serviceType. While a query is active, every section with a match forces itself open regardless of its collapsed state (and the collapse header's chevron/tap-to-toggle is disabled while searching, since there's nothing useful to collapse mid-search); clearing the query restores whatever expand/collapse state the staff member had before. Shows a "No garments match" message when a query has zero results. This directly addresses the scaling concern raised in "Iron-only tier reintroduced" (192 items now, up from the 149 at the time that note was written) — no separate library, just a `filteredGarments` memo feeding the same `groupedByService` pipeline.

---

## New "Wash" service — IMPLEMENTED and reseeded

Client wants a new service type, "Wash," priced at exactly 1.5× the Ironing price for the same garment, across all 5 categories in the iron-only tier (Women's, Men's, Kids, Delicate & Premium, Home Linen) — same 43-item scope as the iron-only tier, generating a parallel "Wash" tier (43 more rows).

**Resolved (decision)**: 1.5× is a **one-time calculation for the initial price only** — admin can edit Wash and Iron prices independently afterward, same as every other catalogue pair (see "Major pricing model update" point 5) — no live/formulaic coupling between the two, consistent with how this codebase already treats every other same-item-different-tier pricing pair.

**Correction to an earlier claim in this file**: a prior draft stated the 192-item catalogue was "already generated in `garments-seed-data-v3.json`" — that file never existed. **The 43 Wash rows were instead added directly into the existing `garments-seed-data-v2.json`** (still at that filename despite being v3-in-substance, same pattern as the original 149→192 growth documented under "Iron-only tier reintroduced") — category prefix `"Wash Services — "` (mirroring `"Iron Services — "`), `serviceType: 'wash_fold'` (there is no separate `'wash'` value in the confirmed 3-service list — `serviceType` stays `wash_fold`/`ironing`/`dry_clean`; "Wash" as a client-facing tier name is a `category` label, not a new `serviceType`), `pricingUnit: 'per_piece'`, each row carrying a `_note` documenting the exact iron→wash calculation for traceability.

**Reseeded and verified.** `garment_catalogue` now has **192 active rows** (149 + 43), confirmed via `backEnd/prisma/seed.ts`'s own count log (`43 created, 149 updated, 0 deactivated`). Spot-checked the 1.5×-rounded-up math directly against the live DB (seed script's own report, not just the JSON): Bath Towel ₹20→₹30, Bed Sheet (Double) ₹35→₹53, Bed Sheet (Single) ₹25→₹38 — all exact matches for "1.5×, rounded up to the nearest rupee."

---

## Icons for garment types — IMPLEMENTED

Client wants icons attached to garment types. **Resolved (decision)**: a small shared icon set mapped by garment type/keyword (shirt, saree, kurta, trouser, bedsheet, bag, shoe, etc.), with `GarmentCatalogue` getting an `iconKey` field admin can override per item if the auto-mapping guesses wrong.

**Implemented.** `GarmentCatalogue.iconKey` (`String?`, `@map("icon_key")`) added to `schema.prisma` and pushed to the live DB. **Icon library choice, not asked for in advance so decided here**: `@expo/vector-icons`'s `MaterialCommunityIcons` set — no new native dependency (ships via `expo-font`, already a dependency, no `react-native-svg` needed the way `lucide-react-native` would require), and has the best clothing/home-item coverage of Expo's bundled sets. `iconKey` stores the MCI icon name directly (e.g. `"tshirt-crew"`, `"bed"`, `"shoe-formal"`) rather than an abstract key needing a second translation table — simpler, and admin can type any valid MCI name to override.

**Auto-mapping**: `backEnd/prisma/iconMapping.ts`'s `resolveIconKey(itemName)` — an ordered, first-match keyword-regex table, called from `seed.ts` for every seeded row (a per-item `iconKey` in the seed JSON wins over the auto match, though none currently set one). **Honest limitation, not glossed over**: MaterialCommunityIcons has strong icons for bags, footwear, bedding, curtains, and literal shirts/t-shirts, but genuinely no dedicated icons for most ethnic wear (saree, kurta, lehenga, dhoti, sherwani, dupatta) or lower-body garments (pants, jeans, shorts, palazzo) — these fall back to a generic `hanger` (or `tie` for structured formalwear: blazer/suit/sherwani/jacket/coat) rather than a fabricated precise-looking match.

**Reseeded and reported, per the client's explicit ask to flag weak matches rather than trust all items were mapped well**: of 192 rows, **62 got a strong (confident) match, 130 got a weak/approximate match** — the seed script prints every weak item with its fallback icon (`⚠ N items got a weak/uncertain auto-mapped icon`), so any of these can be corrected individually via the admin catalogue's new icon override field without re-running the whole seed. The weak list is dominated by exactly the categories flagged above (saree/kurta/lehenga/dhoti/sherwani/pants/jeans variants, repeated across Dry Cleaning, Wash & Iron, Iron Services, and Wash Services tiers since the same item names recur across tiers).

**Mobile**: `Garment`/`GarmentInput` (`mobile/src/api/garments.ts`) gained `iconKey: string | null`. `NewOrderEntryScreen.tsx`'s garment rows and `GarmentCatalogueScreen.tsx`'s catalogue cards both render the icon (`MaterialCommunityIcons name={garment.iconKey ?? 'hanger'}`) next to the item name. `GarmentCatalogueScreen.tsx`'s create/edit modal gained an "Icon (optional override)" text field with a live icon preview, wired into `createGarment`/`updateGarment`'s existing payload alongside the other pricing fields (same shared-handler pattern as `category`/`pricingUnit`/etc. — see "`requiresSpecialCare` — RESOLVED" above).

---

## Customer creation — RESOLVED, ground-truth check corrected an earlier assumption

**Correction to the earlier version of this note**: it claimed `createOrder` "requires an existing `customerId`" — that was backwards. `orderService.ts::createOrder` has always done a `customer.upsert` keyed on `(phoneNumber, branchId, locationLabel)` internally; it never reads a `customerId` at all. The real gap was narrower: there was no way to *look up* a customer ahead of submitting an order (so staff couldn't tell "existing customer" from "new" before hitting confirm), and no standalone search/create endpoint.

**Implemented.** `POST /api/v1/customers` (staff **and** admin — unlike the admin-only discount/billing endpoints) and `GET /api/v1/customers/search?phone=` in `src/controllers/customerController.ts` / `src/routes/customers.ts`. Both use `customerSelectForRole(role)` (primary defense, same as the order-derived customer data) since a staff-role caller reaches these directly, not just through order creation. `POST /` is idempotent on the same unique constraint `createOrder` already upserts on; a staff caller is locked to their own `branchId` (any `branchId` in the body is ignored), an admin must supply one explicitly (falls back to their own if branch-scoped). `GET /search` is branch-scoped the same way `listCustomersHandler` is.

Mobile: `mobile/src/screens/staff/NewOrderEntryScreen.tsx` now opens with a phone-search step (`searchCustomers`) instead of three raw text fields — a match shows existing customers at that number (tap to select, with a "Monthly" tag if `billingMode === 'monthly_billing'`, surfaced here since staff can read but not change billingMode) plus a "new customer / location for this number" link; no match shows an inline name+location form that calls `createCustomer` to confirm. Only once a customer is confirmed does the garment picker and "Confirm Pickup" unlock — one continuous flow, no screen detour. Final order submission still goes through the existing `createOrder` (unchanged contract), which upserts the same record the search/create step already resolved. `mobile/src/api/customers.ts` gained `searchCustomers`/`createCustomer`/`CustomerLookup` (a `Customer` variant without the `branch` relation, which these endpoints don't join). Tests: `src/__tests__/customerController.test.ts`'s new "POST /" and "GET /search" blocks (role gate, branch-locking for staff, required-branchId for admin, primary-defense select assertions).

---

## Order status — RESOLVED, `GET /orders/:id` exists but had a real scoping bug

Ground-truth check confirmed `GET /api/v1/orders/:id` (`getOrderHandler` → `orderService.getOrder`) does exist and does apply the staff-hidden-fields protection (`customerSelectForRole(role)`) — but **it applied zero branch or staff scoping**, worse than the "Staff-scoped order visibility" gap below assumed: any authenticated staff or admin could fetch any order by id, from any branch, not just their own. Fixed as part of that same work — see below.

---

## Staff-scoped order visibility — RESOLVED and implemented, including the branch-scoping bug in `getOrder`

**Confirmed requirement**: each staff member sees/manages only their own assigned orders (`staffId`), not every order in the branch. Admin visibility is unchanged (branch-scoped or unscoped, per the existing admin model).

**Implemented, read side.** `orderService.ts::listOrders` now accepts an optional `staffId` and filters `where: { staffId }` when the caller's role is `'staff'`. `orderService.ts::getOrder` was changed from `prisma.order.findUnique` to `findFirst` so it can filter by `scope.branchId` (`customer.branchId`) and `scope.staffId` at the query level — an out-of-scope order now comes back as `null` (indistinguishable from "doesn't exist"), rather than the previous zero-scoping behavior. `orderController.ts` computes the same `effectiveBranchId` logic (branch-scoped user's own `branchId` always wins; unscoped admin may pass `?branchId=` or omit it) for **both** `listOrdersHandler` and `getOrderHandler` now — previously only `listOrdersHandler` had it, so this also fixes a branch-scoped admin's ability to fetch orders outside their branch via the single-order endpoint, which was open before this change too.

**Implemented, write side.** `orderService.ts::updateStatus` now does an ownership pre-check for `role === 'staff'`: fetches the order's `staffId` and 403s (`Forbidden: you can only update orders assigned to you`) if it doesn't match the requester's own id (`changedById`) — there's no separate "acting staffId" concept for a status update the way `createOrder` has one for admin-assigning-to-staff, so the requester's own id doubles as the ownership check. 404s if the order doesn't exist. Admin is unaffected — the pre-check only runs for `role === 'staff'`.

**Edge case (admin-created order, `staffId` null) — RESOLVED, and a real security gap was found and fixed alongside it.**

**Correction to the earlier version of this note**: "admin-created order has `staffId: null`" was actually never true — `orderService.ts::createOrder`'s default is `input.staffId ?? input.createdById`, so an admin creating an order without specifying `staffId` gets it assigned to *themselves* (their own admin user id), not `null`. Practically this still made the order invisible to every staff member (no staff account shares an admin's id), just via a different mechanism than described.

**Real gap found while fixing this**: `orderController.ts::createOrderHandler` forwarded `staffId` straight from the request body with **no role check** — a staff-role caller could set `staffId` to a colleague's id and hand an order to them, silently defeating the ownership checks this same section built on `listOrders`/`getOrder`/`updateStatus`. **Fixed**: `createOrderHandler` now only honors a body-supplied `staffId` when `req.auth!.role === 'admin'`; a staff caller's own id always wins regardless of what the body sends.

**Resolution, per explicit decision**: rather than special-casing `staffId` at creation time (there's no admin order-creation mobile screen anyway — `NewOrderEntry` only exists in `StaffStack`, confirmed via `AdminStack.tsx`/`AdminTabs.tsx`), admin gets a general **(re)assignment control** usable on any order, any time, regardless of who created it or who it's currently assigned to. **Implemented**: `PATCH /api/v1/orders/:id/assign` (admin-only; `orderService.ts::assignStaff`) validates the target user exists and has `role: 'staff'`, and that their `branchId` matches the order's customer's `branchId` (400 otherwise) — then updates `order.staffId`. Mobile: `OrderStatusScreen.tsx` gained an admin-only "Assigned Staff" card (a chip row of the order's branch's staff members, fetched via `fetchUsers(order.customer.branchId)` filtered client-side to `role === 'staff'`, since there's no role-filter query param on `GET /users`) — tapping a chip calls the new `assignOrderStaff` and updates in place. Names shown via `getDisplayName` (see "Admin display naming" above). Tests: `src/__tests__/orderService.test.ts`'s "assignStaff" block (missing/wrong-role target, missing order, branch mismatch, successful reassignment) and `src/__tests__/orderController.test.ts` (new file — staffId trust: a staff caller's body-supplied `staffId` is ignored and forced to their own id, an admin's is honored; `/assign` route role gate).

Tests: `src/__tests__/orderService.test.ts`'s new "getOrder / listOrders — staff-scoped visibility" block (query-construction-level assertions for both) and "updateStatus — staff ownership check" block (403 for a non-owning staff member, 200 for the owner, 404 for a missing order, no pre-check at all for admin) — plus the existing "updateStatus — delivery billingMode branch" tests were updated to mock the new ownership-check query since they call `updateStatus` with `role: 'staff'`.

---

## Staff/Admin account management — RESOLVED, and the existing `GET /users` route was a bug

Ground-truth check found `routes/users.ts` had `GET /me` and `GET /` (admin-only) both wired to the **same** `getCurrentUser` handler — `GET /` looked like a user-listing endpoint but actually just echoed back the requester's own decoded token, admin-gated or not. No creation endpoint existed at all.

**Implemented.** `src/controllers/userController.ts` gained `listUsersHandler` (admin-only, branch-scoped the same way `listCustomersHandler`/`listBranchesHandler` are) and `createUserHandler` (admin-only; `fullName`, `phoneNumber`, `role` (`'staff' | 'admin'`), `branchId` — required for staff, optional/null for admin per the existing unscoped-admin pattern; 409s on a duplicate `phoneNumber`; no password field, since auth is OTP-only). `routes/users.ts`'s `GET /` now points at the real list handler, and a `POST /` route was added — `GET /me` is untouched. Mobile: `mobile/src/api/users.ts` (`fetchUsers`, `createUser`) and a new `mobile/src/screens/admin/StaffManagementScreen.tsx` (list grouped by branch, plus an "All Branches (Unscoped Admin)" section — role tag per account, "+ Add Staff / Admin" opens a create-only modal with a role toggle and a branch-chip picker, the chip row gaining an "All Branches" option only when Admin is selected). Reachable via a new "Staff" tab in `AdminTabs.tsx` (after Branches) — not added to any staff-facing navigation. This screen is create-and-list only; no edit/deactivate flow was built (not asked for).

Tests: `src/__tests__/userController.test.ts` (new file — role gate on both routes, confirms `GET /` returns real `findMany` results rather than the requester's own token payload, branch-scoping precedence, role/branchId validation, 409 on duplicate phone).

---

## Laundry bag tracking — RESOLVED and implemented

**Design question this note had to answer first**: `Customer.bagIssued`/`bagIssuedAt` is a single boolean + timestamp, not a count or history — that's only enough to answer "has this customer ever been given a bag," not "how many times has it been replaced." Resolution: **issuance and replacement are tracked as two different kinds of event, not the same field reused**:
- **Issuance** happens *once* per customer, ever. `bagIssued`/`bagIssuedAt` flip from `false`/`null` to `true`/`now()` the first time, and **never reset** — there's no "first bag" counter needed because the boolean itself already encodes it: `false` means "hasn't happened yet," `true` means "already happened once." Marking an already-issued customer as issued again is a deliberate no-op (doesn't touch `bagIssuedAt`).
- **Replacement** (lost/damaged) is a *repeatable* event, logged as its own `AdditionalCharge` row (`chargeType: 'bag_replacement'`, fixed `amount: 350`) every time it happens — this is where "how many times has this customer's bag been replaced" actually lives (as a count of rows), not as a second boolean. Reporting a replacement requires `bagIssued` to already be `true` (400 otherwise — can't lose a bag that was never handed over) and does **not** touch `bagIssued`/`bagIssuedAt`, since the customer's one free issuance already happened.

**Implemented.**
- `PATCH /api/v1/customers/:id/bag-issued` (staff + admin — staff need this at the point of pickup) — idempotent, sets `bagIssued: true`/`bagIssuedAt: now()` only if not already issued.
- `POST /api/v1/customers/:id/bag-replacement` (staff + admin) — creates the fixed-₹350 `AdditionalCharge` (`orderId` optional, ties the report to a specific pickup/delivery if given; `description` optional free text). 400s if the customer's `bagIssued` is still `false`.
- `GET /api/v1/customers/:id/bag-replacements` (admin-only) — lists that customer's replacement history, used to show a count.
- All three in `src/controllers/customerController.ts` / `src/routes/customers.ts`.

**Mobile**: `NewOrderEntryScreen.tsx` shows a "Bag Issued" tag or an "Issue Laundry Bag (Free)" button right below the confirmed-customer card (staff is physically at the pickup — the natural moment to hand it over), calling the new `markBagIssued`. `CustomerManagementScreen.tsx`'s edit modal gained a "Laundry Bag" section (status text + issued date, replacement count fetched via `fetchBagReplacements`) with a "Report Lost / Damaged (₹350)" button when issued, or a "Mark Bag Issued" button when not — admin can do either, not just staff, since the backend allows both roles on both write endpoints.

**Invoice wiring — now IMPLEMENTED, closing the gap this section used to flag.** Client's instruction: wire the ₹350 charge to the invoice "only if it is not the first one... from the second bag onwards" — read as clarifying, not adding a new exemption: the free initial bag (the customer's first bag) was never a charge to begin with, so there's nothing to exclude there; every actual *replacement* (numerically the customer's second bag onward) now gets added to the invoice. There's no "first replacement is free" rule anywhere — every `bag_replacement` `AdditionalCharge` row is billed.

**Implemented.** `invoiceService.ts::generateInvoice` now looks up `AdditionalCharge` rows with `chargeType: 'bag_replacement'` **tied to that specific order** (`orderId` match) and adds their total on top of the discount-adjusted subtotal — flat, not discounted, since a lost bag isn't a laundry service. `invoicePdfService.tsx` gained an `additionalChargesTotal` line, itemized separately from the discount line ("Additional Charges" row before "Amount to be paid") rather than silently folded into a bigger number with no explanation. `customerController.ts::reportBagReplacementHandler` now also triggers `reissueInvoice(orderId)` when the report is tied to an order that isn't yet delivered/paid — same shared reissue function discount changes and amount revisions already use — so the customer's payment link reflects the ₹350 immediately, not on some later unrelated trigger.

**Still open, unchanged from before**: a replacement reported *without* an `orderId` (customer calls in separately, no pickup/delivery context) still has nothing to attach to — that's the same "does it attach to the next order, get billed standalone, wait for the monthly statement" question this section originally raised, and it's still genuinely unanswered. Only the order-tied case was asked for here.

Tests: `src/__tests__/customerController.test.ts`'s "bag-issued"/"bag-replacement"/"bag-replacements" blocks (idempotency, 404s, the bagIssued-required-first validation, the fixed ₹350 amount, role gates, and new: reissue fires when tied to an open order, doesn't fire when delivered/paid or untied) and `src/__tests__/invoiceService.test.ts`'s new "bag-replacement charges tied to this order" block (single charge, multiple charges summed, charge added after discount not before, no charge when none exist).

---

## Payment marking — IMPLEMENTED

`Order.paymentStatus` existed on the schema but **no endpoint anywhere updated it** — this directly left half of this file's own "Order workflow" step 7 unimplemented: "At delivery, the executive verifies payment status and marks the order both **Delivered** and **Payment Received**."

**Implemented.** `PATCH /api/v1/orders/:id/payment` (`orderService.ts::recordPayment`, staff + admin) validates `paymentMethod` against the four confirmed modes (`cash | upi | net_banking | credit_card` — `src/types/enums.ts` gained `PaymentMethod`/`OrderPaymentStatus`), creates a `Payment` row (`paymentType: 'order_payment'`, `status: 'success'`, the discount-adjusted amount via the same `calculatePayableAmount` the invoice and ledger charge already use — not the raw `finalAmount`), and flips `order.paymentMethod`/`paymentStatus` to `'paid'` in the same transaction. Same staff-ownership check as `updateStatus` (a staff member can only record payment for an order assigned to them), and 400s if attempted for a `monthly_billing` customer — those are settled via the ledger, not per-order, per this file's existing billingMode branch.

**Bundled into the delivery action, per this section's own earlier recommendation** — not a separate screen. `OrderStatusScreen.tsx`: when the next transition is to `Delivered` and the customer is on daily billing, a payment-method picker (four options, same toggle style as the Admin/Staff login switcher) must be selected before the button — now labeled "Mark Delivered & Payment Received" — is enabled; pressing it calls `recordOrderPayment` then `updateOrderStatus` in sequence (payment first, so a failure there doesn't leave the order marked delivered with nothing recorded). Monthly-billing customers skip the picker entirely — nothing changes for them. Once paid, a small "Payment received · {method}" line shows above the status track. `mobile/src/api/orders.ts` gained `PaymentMethod`, `recordOrderPayment`, and `Order.paymentMethod`/`OrderCustomer.billingMode` (needed client-side to decide whether to show the picker at all).

Tests: `src/__tests__/orderService.test.ts`'s new `recordPayment` block (invalid method, 404, staff-ownership 403, monthly-billing 400, successful Payment-row creation, discount-adjusted amount).

**Verified while building this: invoices ARE persisted to the database**, not just generated in memory — `invoiceService.ts::generateInvoice` ends with `prisma.invoice.upsert(...)`, keyed on `orderId`, and every invoice-related test in `src/__tests__/invoiceService.test.ts` asserts against that persisted row. Nothing further needed there; this was a verification, not a gap.

---

## Login bug — phone validation, one part real (now fixed), one part still needs client confirmation

**Issue 2 (phone number field can't be edited after the OTP screen appears) — confirmed real, now fixed.** `mobile/src/screens/shared/LoginScreen.tsx`'s phone `TextInput` still has `editable={step === 'phone'}` (kept — no reason to allow editing mid-OTP-entry, which could desync the number the OTP was actually sent to), but a **"Change number" link** now appears next to the Phone Number label whenever `step === 'otp'`. Tapping it (`handleChangeNumber`) clears the OTP field and any error, and drops back to the phone step so staff can correct a mistyped number without leaving the screen. Per this file's explicit instruction to fix outright without waiting on confirmation, since it's an unambiguous UX bug, not a design decision.

**Issue 1 (any phone number proceeds straight to the OTP screen) — the draft's framing doesn't match what's actually in the code, checked directly.** `src/controllers/authController.ts::requestOtp` already does `const user = ... await prisma.user.findUnique(...); if (!user) { res.status(404).json({ error: 'User not found' }); return; }` — an unregistered number gets an explicit 404 **before** the generic `"OTP sent if the user exists"` response is ever reached; that generic-sounding message text is dead/misleading (it only ever fires after a real user was already found, so it never actually masks a non-existent one). There is no enumeration-prevention behavior in the real code path to "reverse" — the backend already reveals registration status via the 404, and the mobile `LoginScreen.tsx`'s `handleSendOtp` already surfaces that as an error instead of advancing to the OTP step (`catch (err) { setError(...) }`, no `setStep('otp')` call on failure).

**Most likely explanation for the reported testing observation**: `MOCK_AUTH` was probably on wherever this was tested — `authController.ts`'s `mockUserFor(phoneNumber)` always returns a truthy mock admin user for *any* phone number under `MOCK_AUTH`, bypassing the real `prisma.user.findUnique` lookup entirely. Under that flag, every number would look "registered" and proceed straight to the OTP step, matching the reported behavior — but that's `MOCK_AUTH`'s documented purpose (local dev without a DB), not a production security gap.

**Recommendation, still not acted on**: if a friendlier "this number isn't registered" message is wanted instead of a raw 404/generic error, that's a small copy/UX change to the existing (already-distinguishing) response — not the enumeration-prevention reversal the draft assumed was needed. Worth confirming which of these was actually intended before building anything, since the premise changed once the real code was checked.

---

## Ad-hoc / custom catalogue items — RESOLVED, client confirmed

If a customer brings something genuinely not in the catalogue, staff has no way to add a custom-priced line item — `createOrder` only accepts references to existing `GarmentCatalogue` rows. **Client confirmed: only admin can add it** — this is not staff inventing a free-text price at pickup, it's admin adding the new item to the catalogue (same as any other catalogue change), which staff then has available like any other item.

**No code change needed — already true.** `routes/garments.ts` already gates `POST /` and `PATCH /:id` to `requireRole(['admin'])`; staff's `GET /` is read-only. This matches this file's own opening non-negotiable ("Staff have read-only access to the garment catalogue. Only admin can create/edit/delete garment types and prices") — the client's confirmation didn't change anything, it ruled out the alternative (a staff-side ad-hoc/free-text price entry), which was never built and isn't being built now.

---

## Known gaps found during the billing/discount toggle work

- **Implemented (2026-07-20).** Admin Customer Management screen, closing the gap noted below. `mobile/src/screens/admin/CustomerManagementScreen.tsx` — list grouped by branch (section header per `branchId`), a card per customer (name, location label, phone, a "Monthly" tag when `billingMode === 'monthly_billing'`, a "Discount ON" tag when `discountEnabled`), tapping a card opens a bottom-sheet modal (same pattern as `GarmentCatalogueScreen`/`BranchesScreen`) to edit `billingMode` (two-segment toggle), `discountEnabled` (two-segment toggle), and `discountPercent` (text field, disabled/greyed while `discountEnabled` is off — never cleared when toggled off, per the discount section above). Save only calls whichever of the three PATCH endpoints actually changed, not all three unconditionally. Reachable via a new "Customers" tab in `AdminTabs.tsx` (between Catalogue and Ledger) — not added to `StaffStack`/`StaffTabs`, so it's structurally unreachable from the staff navigation stack; staff's existing read-only `billingMode` visibility (e.g. at delivery) is untouched.

  **New backend endpoint, not previously flagged as needed**: `GET /api/v1/customers` (admin-only), added because no customer-listing endpoint existed at all — the earlier PATCH-only endpoints had nothing to build a list screen against. Branch-scoped the same way `listBranchesHandler` is: a branch-scoped admin's own `branchId` always wins over any `?branchId=` query param; an unscoped admin can pass `?branchId=` to narrow the view or omit it to see every branch. Returns the full `Customer` row plus `branch.branchName` (admin-only route, so no `customerSelectForRole` narrowing needed — same reasoning as the existing PATCH handlers). `mobile/src/api/customers.ts` is the new client module. Tests: `src/__tests__/customerController.test.ts`'s new "GET / —admin-only list" block (role gate, branch-scoping precedence, branch name included).

  **Not yet verified visually in a running browser** (unlike the earlier light/dark-mode pass) — `MOCK_AUTH` is off on the currently-running dev server and the customers table is empty in the live DB, so a real screenshot would need either real OTP credentials or spinning up a parallel mock-auth backend instance; skipped as disproportionate for a screen that mechanically mirrors three already-verified sibling screens. Backend: `tsc --noEmit` clean, 75/75 tests passing. Mobile: `tsc --noEmit` clean. Flag if you want the full browser-driven check done anyway.
- **Fixed (2026-07-20).** `config/index.ts`'s `getEnv` used `??` (nullish coalescing) alone, which doesn't catch an env var that's *present but empty* — this repo's `.env` has `JWT_SECRET=` (empty string), which silently resolved to `''` instead of the intended fallback. `jsonwebtoken` rejects an empty secret outright, so any code path calling `jwt.sign` with it would throw. Fixed by treating `''` the same as unset in `getEnv`. Test: `src/__tests__/config.test.ts`.
- **Fixed (2026-07-20).** The ledger's delivery-time charge (`orderService.ts::updateStatus`, monthly-billing branch) was posting the raw `finalAmount`, not discount-adjusted — a monthly-billing customer with a discount enabled would have their ledger balance silently overcharged relative to what their invoice actually says. Both now share `src/utils/pricing.ts`'s `calculatePayableAmount(finalAmount, customer)`. Note this required a small design consideration: `order.customer` inside `updateStatus` is fetched via the role-scoped `customerSelectForRole(role)` (staff-hidden fields excluded for a staff-role caller), so the discount fields needed for this *internal* calculation are looked up via a separate, unconditional `prisma.customer.findUnique({ select: { discountEnabled, discountPercent } })` rather than widening the role-scoped select — that would have leaked the fields into the staff-facing response body (caught by the `staffFieldFilter` safety net, but violates the "primary defense" principle of never fetching them for a staff request in the first place). Tests: `src/__tests__/orderService.test.ts` (discount-adjusted charge, full charge when disabled, confirms the lookup is independent of role-scoped `order.customer`), `src/__tests__/pricing.test.ts` (the shared function directly).

---

## Still open — do not assume, ask before building

- Final logo source file itself (client confirmed SVG format, no actual file sent yet — see "Branding" above)
- **App store assets (icon, screenshots) — ours to suggest, client deferred** ("Please you can suggest - not sure"). No design work started yet. Starting suggestion, not final: app icon as a simple monogram ("P&B" or a stylized ampersand echoing the logo's serif "&") on the peach `#F2764A` background — icons need to read clearly at 40px, so the full "Peach & Blue" wordmark won't work at icon size, only a mark will; revisit once the real logo SVG is in hand rather than designing off placeholder colors. Screenshots (once real UI exists to capture, not empty states): Staff Home (today's pickups), New Order Entry (garment picker + running total), Admin Dashboard, and Ledger & Aging — 4 screens is typically enough for both stores' minimums.

**Resolved: default admin view is All Branches**, not single-branch. `AdminDashboardScreen.tsx` already implements this correctly as a consequence of `branchId` scoping (`user.branchId == null` → "All Branches ▾" chip, no branch filter passed to `listOrders`) — no code change needed there. What this resolves is the *account-level* scoping question CLAUDE.md's "Admin accounts" section flagged: the two live admin accounts are currently scoped to Attapur (`branchId` set), not unscoped — update them to unscoped (`branchId = null`) so this default actually takes effect, now that it's confirmed rather than assumed.

---

## Light/dark mode — Implemented, defaults to light

`mobile/src/theme/theme.ts` exports `lightColors`/`darkColors` (a `ColorTokens` shape both must satisfy) instead of one static `colors` object. Some tokens are deliberately identical across both palettes rather than flipping: `peachPrimary`/`peachPrimaryDark`/`white` (brand accent + button-label text), `chrome` (the dark navy bar used for every app bar/footer/tab bar/total bar — already dark in light mode, doesn't need to get "darker"), and `cream` (light header-title text sitting on that fixed `chrome` bar). Everything else (`peachBg`, `peachCard`, `surface`, `navy`, `navyText`, `navyDeep`, `border`, `muted`, `successBg`, `warningBg`) flips. `mobile/src/context/ThemeContext.tsx` (mirrors `AuthContext.tsx`'s conventions) holds the mode, persisted via `expo-secure-store` (no AsyncStorage dependency added), default `'light'`. A new `mobile/src/screens/shared/SettingsScreen.tsx` houses the toggle plus the About-page content this file separately required ("Technology by NIVENXA") — bundled into one screen since neither existed before, registered in both `AdminStack`/`StaffStack`, reachable via a settings icon on the Admin/Staff home app bars. `app.json`'s `userInterfaceStyle` changed from `"light"` to `"automatic"` so native iOS chrome (keyboard, alerts) doesn't clash with an in-app dark theme.

Small fixed-pastel "chip" badges (`theme/serviceTag.ts`'s service tags, `BranchesScreen.tsx`'s apartment/area tags) intentionally keep their existing background+foreground pairing across both themes rather than following the flipping tokens — they're small, self-contained, already-contrasted elements, not full surfaces.

Not built: OS-appearance-following ("system") mode — this is a manual `'light' | 'dark'` toggle only, not asked for beyond that.

---

*Full specs: `/docs/PeachBlue_Technical_Design_Document.md`, `/docs/PeachBlue_Laundry_App_Planning_Pack_v2.md`, `/docs/database_schema_v3.sql`.*