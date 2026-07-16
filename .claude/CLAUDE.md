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

---

## Order workflow (confirmed)

1. Customer requests pickup via phone call or WhatsApp — same-day or a scheduled date/time slot.
2. Staff physically visits, collects clothes, categorizes items by garment type from the admin-managed catalogue.
3. System auto-calculates an **estimated amount** from the rate master. This is shown to the customer as informational only at this point — not a final confirmed price.
4. Order status becomes **Picked/Pending** (this is the only pre-delivery status the customer sees). Internally, staff/admin can track finer sub-stages — keep `internal_status` separate from the customer-facing status; derive the customer-facing label in application code rather than storing it as a second column that can drift out of sync.
5. **Before delivery, admin may revise the final amount.** If revised: log old amount, new amount, reason, and who changed it (`order_amount_revisions`), and send the customer a WhatsApp + SMS message with the revised amount and the reason.
6. Order marked **Delivered**.
7. Payment: QR code scan (Razorpay-generated, printed/sent on the bill) or cash. Receipt reflects the method used.
8. Monthly-billing customers see outstanding balance on every bill; get a distinct "balance cleared" receipt once fully settled.

**Not in scope right now**: discounts/coupons (client confirmed none currently), staff auto-assignment/dispatch (not needed at 1–2 staff per branch — they self-select requests off WhatsApp).

---

## Branding

- Peach/coral primary: `#F2764A` (backgrounds, accents, buttons)
- Navy: `#16305C` (text — especially pricing, per client's explicit direction — and headers)
- These hex values were read off client-provided artwork (a branded pickup bag), not an official brand guide — **replace with exact values once the client sends the logo source file (SVG/AI)**, still outstanding as of this writing.
- Tagline: "Fresh. Clean. Perfectly cared for."

---

## Services — RESOLVED

Confirmed via client marketing materials (price list + service slides): **Wash & Fold, Steam Ironing, Dry Cleaning (Premium Care), Curtain/Bedsheet/Sofa Cover Cleaning, Special Care for Delicate & Designer Wear.** Pickup & Delivery is doorstep logistics, not a billable service type.

`garment_catalogue.serviceType` is a plain string (not a hard DB enum, deliberately) — seed values should use: `wash_fold`, `ironing`, `dry_clean`, `specialty_care`. Full priced catalogue (40+ items) is in `docs/seed-data/garments.json` — see Claude Code prompts for how to load it.

**Two data points from the client's price list need a quick confirmation, not yet locked in:**
- "Suit (2-Piece)" appears twice on their price list at two different prices (₹120 and ₹150) — almost certainly the second one should read "Suit (3-Piece)". Seeded as such below; verify with client and correct if wrong.
- "Designer Dress" is priced as a **range** (₹80–₹150), unlike every other item which has a single fixed price. Schema now supports an optional `priceMax` on top of `price` for this case (staff picks the final price within the range at pickup) — confirm this is actually the operational intent before treating it as final.

---

## New business rules to build — not yet in the schema

- **Laundry bag tracking**: first bag free per new customer; ₹350 charged if lost/damaged. Needs a `bagIssued` / `bagIssuedAt` flag on `Customer` and a way to charge the ₹350 replacement fee as a distinct line item (not a garment charge) — see Claude Code prompts.
- **30-day pilot program** (per apartment branch): free registration, free bag, introductory pricing, dedicated pickup schedule, continues post-pilot based on satisfaction. Introductory pricing implies branch-level pricing may need a `pilotEndsAt` date and a way to apply different prices before/after — not yet modeled, flagged for a design decision rather than assumed.
- **Turnaround time (24–48 hours)** — informational, worth including in the pickup confirmation WhatsApp/SMS message text.

---

## Tech stack decisions

- Backend: Node.js + Express, **TypeScript** (financial/ledger calculations benefit from compile-time type safety)
- ORM: **Prisma**, schema translated from `database_schema_v3.sql`
- Database: PostgreSQL on Supabase (already provisioned, schema already run — verify tables match `database_schema_v3.sql` before building on top of it)
- Mobile: React Native — **Expo recommended** (simpler setup, EAS Build solves iOS builds without needing a Mac) unless a native module (check Razorpay's RN SDK) needs bare RN
- Payments: Razorpay, QR-code based (no in-app checkout — there's no customer app to check out in)
- Messaging: WhatsApp Business API or Twilio, plus SMS — both sent together, always
- PDF generation: Puppeteer or React-PDF, run as a background job, never inline with the request that completes an order
- Push notifications: Firebase Cloud Messaging (staff/admin devices only)

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
- Confirm the "Suit (2-Piece)" vs "Suit (3-Piece)" price-list typo with the client (see Services section)
- Confirm the Designer Dress price-range handling (₹80–₹150, staff picks final price) is actually what's wanted operationally
- Decide how pilot-program introductory pricing should work at the data-model level (see New business rules above) — not yet designed
- Light/dark mode requirement
- App store assets (icon, screenshots) — client-provided or need creation
- Default admin branch-scoping behavior in the UI (single-branch view vs all-branches view as default)

---

*Full specs: `/docs/PeachBlue_Technical_Design_Document.md`, `/docs/PeachBlue_Laundry_App_Planning_Pack_v2.md`, `/docs/database_schema_v3.sql`.*