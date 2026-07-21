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

`garment_catalogue.serviceType` is a plain string (not a hard DB enum, deliberately) — seed values: `wash_fold`, `ironing`, `dry_clean`. The earlier 4th tag (`specialty_care`) has been folded into `dry_clean` — that's how delicate items are operationally handled anyway.

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

**Resolved: bag policy.** The laundry bag is free for every customer (not limited to new customers as earlier phrasing implied) — the ₹350 charge only applies if the bag is subsequently lost or damaged. Supersedes the earlier "first bag free for every *new* customer" wording; the ₹350 lost/damaged fee itself is unchanged. Schema support already exists (`Customer.bagIssued`/`bagIssuedAt`, `AdditionalCharge` with `chargeType: bag_replacement`) but no application code uses it yet — issuing the bag and charging the replacement fee is still unbuilt.

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

---

## New business rules to build — not yet in the schema

- **Laundry bag tracking**: first bag free per new customer; ₹350 charged if lost/damaged. Needs a `bagIssued` / `bagIssuedAt` flag on `Customer` and a way to charge the ₹350 replacement fee as a distinct line item (not a garment charge) — see Claude Code prompts.
- ~~**30-day pilot program**~~ **Removed from scope (2026-07-21), per client: "Remove 30-day Pilot Program for now."** Confirmed via a full-codebase search (`pilot`/`30-day`/`pilotEndsAt`/`pilotProgram`, case-insensitive, across `src/`, `mobile/src/`, and `backEnd/prisma/schema.prisma`) that there is genuinely zero code to remove — no stub fields, no placeholder UI, no half-finished migration. The only mention anywhere is in `docs/PeachBlue_Technical_Design_Document.md`, a historical planning doc, not application code — left untouched, since this file (CLAUDE.md) is what governs current scope, not that doc.
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
- The 106-item v2 garment catalogue (`garments-seed-data-v2.json`) has been seeded into the live DB — 106 active rows confirmed. The seed script matches existing rows by `(itemName, category)`, not `itemName` alone — 18 items intentionally share a name across categories at different prices (see "Major pricing model update" point 5); matching on `itemName` alone silently collapses those into one row.
- `Customer.discountPercent` (Decimal, nullable, default 0) has been pushed live, with a `customers_discount_percent_check` CHECK constraint enforcing 0–100. `PATCH /api/v1/customers/:id/discount` (admin-only) is live in `src/controllers/customerController.ts` / `src/routes/customers.ts`.
- `Customer.discountEnabled` (Boolean, default `false`) has been pushed live (`npx prisma db push`) — see "Monthly billing + discount: now live" below. `npx prisma generate`'s Prisma Client type/JS output regenerated successfully (confirmed present in `node_modules/.prisma/client/index.d.ts`); its native `query_engine-windows.dll.node` binary specifically failed to rewrite (`EPERM`, file held open by the already-running dev server process — traced to an untraceable-by-PID handle, not a stray process this session started) — harmless, since the engine binary version didn't change and doesn't encode model-specific fields; only the generated JS/TS (which did update) does.
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