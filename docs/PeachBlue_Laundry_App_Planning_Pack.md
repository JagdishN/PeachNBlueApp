# Peach & Blue — Laundry & Ironing App — Planning Pack v2
**Powered by NIVENXA | Technology by NIVENXA**

*This supersedes the v1 pack. Major change: there is no customer-facing app. Customers interact only via phone call and WhatsApp; the app is staff + admin only, role-based, single codebase.*

---

## 1. What Changed From v1

| Area | v1 assumption | Confirmed (v2) |
|---|---|---|
| Customer app | Full RN app: catalogue, cart, checkout, tracking | **Does not exist.** Customer never opens an app. |
| User roles | Customer, Staff, Admin (3 apps/flows) | **Staff and Admin only**, one app, role-based views |
| Order origin | Customer builds order in-app | Staff monitor WhatsApp, collect clothes, **staff/admin enters order into app** after pickup |
| Item selection | Customer picks garments pre-pickup | Garments categorized **at pickup**, admin owns pricing, staff is read-only on catalogue |
| Staff assignment | Considered auto vs manual dispatch | **Not needed** — 1–2 staff self-select requests off WhatsApp |
| Discounts/coupons | Open question | **None currently** — dropped from scope |
| Estimate revision | Open question | **Yes** — admin can revise before delivery; customer notified via WhatsApp/SMS with a reason if the amount changed |
| Branding | Generic, TBD | **Peach & Blue** — peach/coral background, navy blue text (especially pricing), logo provided |
| Payment | Razorpay in-app checkout | QR code on bill (Razorpay-generated) or cash at delivery; no in-app payment flow since there's no customer app |

This is a **smaller, clearer build** than the original scope. No customer auth, no customer UI, no cart/checkout logic, no push notifications to a customer app.

---

## 2. Confirmed Order Workflow

1. Customer contacts via phone call or WhatsApp to request pickup (same-day or scheduled).
2. Staff (1–2 people monitoring WhatsApp) picks up the request and physically collects the clothes.
3. At the flat, staff categorizes items by garment type using the admin-managed catalogue (staff: read-only view of garment types/prices; **admin has full CRUD**).
4. App auto-calculates an **estimated amount**; customer is informed (via call/WhatsApp) — informational only at this point.
5. Order status set to **Picked/Pending** — this is the only pre-delivery status the "customer" needs to know via message; internally, staff/admin can track finer sub-stages (washing, ironing, ready, out for delivery) in the app.
6. **Before delivery, admin may revise the final amount** if it differs from the estimate. If revised, the system logs the change (old amount, new amount, reason, who changed it) and **sends the customer a WhatsApp/SMS message stating the revised amount and reason**.
7. Order marked **Delivered**.
8. Payment collected: QR code scan (Razorpay) on the printed/sent bill, or cash — receipt reflects the method used ("Cash Payment Received" or paid confirmation).
9. For monthly-billing customers: bill shows outstanding balance; a "balance cleared" receipt is sent once fully paid.
10. All communications (pickup confirmation, amount revision notice, delivery confirmation, receipt, monthly statement, payment reminder) go out via **both WhatsApp and SMS, sent together** — never in-app, since there's no customer app to view them in.

---

## 3. Roles in the App

### Admin
- Full CRUD on garment catalogue and pricing.
- Views/manages all orders across all staff.
- Can revise the estimated amount on any order before delivery (with mandatory reason).
- Manages monthly billing ledger, aging report, statement generation, payment reminders.
- Revenue reporting.
- Manages staff accounts.

### Staff
- Views garment catalogue and prices (read-only).
- Creates a new order after physically collecting clothes: flat number, contact number, service type, itemized garments and quantities.
- Updates internal status (picked up → in progress → ready → out for delivery → delivered).
- Marks payment collected (cash or confirms QR payment received).
- Views their own daily collected/delivered orders and earnings summary.

Since it's 1–2 staff at this scale, there's no dispatch/assignment logic to build — whichever staff member handles a WhatsApp request logs the order under their own account.

---

## 4. Branding

- **Brand name:** Peach & Blue
- **Palette:** peach/coral background and accents, navy blue text — used prominently in the **pricing section** to match the logo's color pairing (peach for the brand name, navy for "& Blue").
- Logo provided by client — once the source file (ideally SVG/AI) is available, pull exact hex values rather than estimating from a rendered image.
- **NIVENXA "Powered by" branding stays in its own fixed, neutral styling** — independent of Peach & Blue's theme, on the splash screen (2 seconds), a subtle footer on all screens, and "Technology by NIVENXA" on the About page. This is intentional: it's how customers/staff/admin recognize who built the app, so it should not blend into the client's theme.
- Since there's no customer-facing UI, the theme only needs to look right for **staff and admin views** — still worth applying consistently so the app feels like a polished Peach & Blue product internally, even though end customers never see the screen.

---

## 5. Revised Scope

### In Scope (v1 build)
- Single React Native app (Android + iOS), role-based views for Staff and Admin — no separate installs.
- Admin: garment catalogue CRUD, order management, monthly billing ledger/aging report, revenue reports, staff management, amount-revision workflow.
- Staff: order creation at pickup, status updates, payment marking, daily earnings view.
- Auto-calculated estimate at order creation; admin-editable final amount with audit trail.
- Invoice/bill generation (PDF), with Razorpay QR code embedded for digital payment.
- WhatsApp and SMS messaging, **sent together on every notification** (not one as a fallback for the other): pickup confirmation, amount revision notice, delivery confirmation, payment receipt, monthly statement, overdue reminder.
- Monthly billing ledger with partial payments and carry-forward balance.
- NIVENXA fixed branding (splash, footer, About page).
- Peach & Blue theming across the staff/admin UI.

### Out of Scope (v1)
- Customer-facing app or portal of any kind.
- Discounts, coupons, promo codes (not currently offered).
- Auto-assignment/dispatch logic for staff (not needed at 1–2 staff scale; revisit if staff count grows).
- Multi-building zone logic (keep the schema flexible for this, but don't build UI for it now).
- In-app customer order tracking (customers get status via WhatsApp/call only).

---

## 6. Architecture (Updated)

```
┌───────────────────────────────────────┐
│      Single React Native App           │
│      (Android + iOS)                    │
│  ┌────────────┐      ┌───────────────┐  │
│  │ Staff View  │      │  Admin View    │  │
│  │ (role-gated)│      │  (role-gated)  │  │
│  └─────┬──────┘      └───────┬────────┘  │
└────────┼─────────────────────┼───────────┘
         │      HTTPS/REST (JWT, role claim) │
         └───────────────┬─────────────────┘
                          │
                 ┌────────▼─────────┐
                 │  Node.js+Express   │
                 │  API (role-based    │
                 │  authorization)      │
                 └────────┬──────────┘
     ┌──────────────────────┼──────────────────────┐
     │                      │                       │
┌────▼──────┐    ┌──────────▼─────────┐   ┌─────────▼────────┐
│ PostgreSQL │    │  Razorpay API       │   │  WhatsApp API /    │
│ (orders,   │    │  (QR generation,     │   │  Twilio BSP         │
│ ledger)    │    │  payment status)      │   │  + SMS, both sent    │
└────────────┘    └───────────────────────┘   └──────────────────────┘
         │
┌────────▼──────┐   ┌────────────────────┐
│ AWS S3/Firebase │   │ Puppeteer/React-PDF │
│ (invoice PDFs)   │   │ (invoice generation, │
│                   │   │ background worker)    │
└───────────────────┘   └────────────────────────┘
```

No customer-facing surface at all — every notification is generated server-side and pushed out via WhatsApp/SMS, not read inside an app.

---

## 7. Still Open — Confirm With Client
- Logo source file (SVG/AI) for exact brand colors.
- Whether Peach & Blue wants light-mode only or dark mode too (less critical now that it's an internal staff/admin tool, but still worth 30 seconds to ask).
- App store assets (icon, screenshots) — does the client have these, or do they need to be created?

Everything else from the original requirements template (Section 1 of v1) that assumed a customer app — billing terms, apartment onboarding, WhatsApp API setup — still applies and is unaffected by this change.
