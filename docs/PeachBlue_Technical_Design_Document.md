# Peach & Blue — Technical Design Document
**Powered by NIVENXA | Technology by NIVENXA**

*Covers system design and, separately, the full deployment process — since you're taking on deployment responsibility for the client, Section 6 onward is written as an execution guide, not just a reference.*

---

## 1. System Overview

Single React Native app (Android + iOS), two role-based views (Staff, Admin). No customer-facing app — customers are reached only by phone call and WhatsApp. Node.js/Express backend, PostgreSQL database, Razorpay for QR-based payments, WhatsApp Business API (or Twilio) and SMS **sent together on every notification** — not one as a fallback for the other.

Since the app never collects payment *through* Apple/Google in-app purchase (Razorpay is used directly for a physical service, like a ride-hailing or food-delivery app), **Apple/Google commission fees do not apply here** — those only trigger on digital goods sold via each store's own IAP system. This matters for the client conversation about ongoing costs — the store fees below are account fees only, not a revenue cut.

---

## 2. Architecture

```
┌───────────────────────────────────────┐
│   React Native App (Android + iOS)      │
│   Staff View  |  Admin View (role-gated)│
└──────────────────┬──────────────────────┘
                    │ HTTPS/REST, JWT auth
         ┌──────────▼──────────┐
         │ Node.js + Express API │
         └──────────┬────────────┘
   ┌─────────────────┼─────────────────────┐
┌──▼───────┐  ┌───────▼────────┐  ┌────────▼─────────┐
│PostgreSQL │  │ Razorpay API    │  │ WhatsApp API/       │
│(orders,   │  │ (QR generation,  │  │ Twilio + SMS          │
│ledger)    │  │ payment status)   │  │ (both sent together)   │
└───────────┘  └───────────────────┘  └──────────────────────┘
      │
┌─────▼──────┐  ┌────────────────────┐
│ File Storage │  │ PDF Generation       │
│ (invoice PDFs)│  │ (background worker)  │
└───────────────┘  └────────────────────────┘
```

---

## 3. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Mobile | React Native | Single codebase, Android + iOS |
| Backend | Node.js + Express | REST API, JWT auth, role middleware |
| Database | PostgreSQL | Hosted on Supabase to start (free tier) — see database planning doc |
| Payments | Razorpay | QR code generation, payment status webhook |
| Messaging | WhatsApp Business API or Twilio, plus SMS — **both sent on every notification, not a fallback pair** | See earlier WhatsApp setup guide |
| PDF generation | Puppeteer or React-PDF | Runs as a background job, not inline with requests |
| File storage | Supabase Storage or S3 | Invoice PDFs |
| Push notifications | Firebase Cloud Messaging | Staff/admin device notifications only |

---

## 4. Data Model

Full schema is in `database_schema_v2.sql` (already delivered). Core tables: `users` (staff/admin only), `customers` (reference record, not login), `garment_catalogue`, `orders`, `order_items`, `order_amount_revisions`, `payments`, `ledger_entries`, `monthly_statements`, `invoices`, `communications_log`, `staff_earnings`.

---

## 5. API Design (high level)

Auth: `POST /api/v1/auth/login` (phone + OTP), returns JWT with `role` claim (`staff` or `admin`).

**Staff endpoints** (role: staff or admin):
- `GET /api/v1/garments` — read-only catalogue
- `POST /api/v1/orders` — create order after physical pickup
- `PATCH /api/v1/orders/:id/status` — update internal status
- `POST /api/v1/orders/:id/payment` — mark payment collected
- `GET /api/v1/staff/earnings` — own daily summary

**Admin-only endpoints:**
- `POST /PATCH /DELETE /api/v1/garments/:id` — catalogue CRUD
- `PATCH /api/v1/orders/:id/amount` — revise final amount (writes to `order_amount_revisions`, triggers WhatsApp notice)
- `GET /api/v1/ledger/aging` — outstanding balances sorted by days overdue
- `GET /api/v1/reports/revenue` — daily/weekly/monthly reports
- `POST /api/v1/staff` — staff account management

**Background jobs** (not directly triggered by API calls):
- Invoice PDF generation on order completion
- WhatsApp + SMS dispatch, both channels sent together for every message (pickup confirmation, amount revision, delivery confirmation, receipt)
- Monthly statement generation — cron, 1st of month
- Overdue reminder — cron, after the 25th

---

## 6. Security

Since the app handles customer PII (names, phone numbers, addresses) and payment flows, security needs to be built in from the start, not bolted on before launch.

### 6.1 Authentication & access control
- Staff/admin login via phone number + OTP, not passwords — removes the risk of weak/reused passwords entirely.
- Short-lived JWT access tokens with refresh tokens, so a stolen token has a limited window of use.
- Role-based access control enforced at the API layer, not just hidden in the UI — a staff-role token must be rejected by the server on admin-only endpoints (garment CRUD, amount revision, reports), even if someone tampers with the app.
- Branch-scoped admin accounts (per the branch model) only ever see data for their own branch at the API level — this is a server-side filter, not a client-side toggle a user could bypass.
- Rate-limit OTP requests per phone number (e.g. max 5 per hour) to prevent OTP-spam abuse, and expire OTPs quickly (2–5 minutes is typical).

### 6.2 Data protection
- All traffic over HTTPS/TLS — no exceptions, including internal calls between services.
- Database encryption at rest (Supabase/most managed Postgres providers enable this by default — confirm it's on, don't assume).
- Secrets (Razorpay keys, WhatsApp/Twilio credentials, JWT signing key, database URL) live only in the hosting platform's environment variables/secret manager — never in the repository, never in this document, never in a screenshot sent over WhatsApp for debugging.
- Input validation and parameterized queries (via the ORM/query builder) throughout — prevents SQL injection by construction rather than by hoping every raw query is written carefully.
- Razorpay handles card/payment data directly (PCI compliance is Razorpay's responsibility) — the app only ever stores a transaction ID and status, never raw card details.

### 6.3 Regulatory note — India's DPDP Act
India's Digital Personal Data Protection Act, 2023 and its 2025 Rules are being phased in — the Data Protection Board was established in November 2025, and the substantive compliance obligations (consent notices, breach notification, data-principal rights) become fully enforceable by 13 May 2027. However, the obligation to maintain **"reasonable security safeguards"** carries penalties of up to ₹250 crore for failure, and this is treated as a live expectation, not something to defer until 2027. Practical steps worth building in now, while it's cheap to do so:
- Collect only the customer data actually needed (name, phone, address/flat — no unnecessary fields).
- Keep a simple internal record of what data is collected and why, even informally — this is the foundation of a consent notice later.
- Have a basic breach-response plan in mind (who gets notified, how quickly) even before it's a strict legal requirement — retrofitting this after an incident is much harder.
- This is a compliance area worth a proper legal review with the client before launch, not just an engineering checklist — flag it to them directly rather than treating it as fully covered by the above.

### 6.4 Ongoing security hygiene
- Run dependency vulnerability scans regularly (`npm audit`, or GitHub's Dependabot) — third-party package vulnerabilities are one of the most common real-world breach paths, not exotic attacks.
- Every amount revision, status change, and payment record already has an audit trail (`order_amount_revisions`, `order_status_history`, `payments.recorded_by`) — this is both a business-accountability feature and a security one, since it means unusual activity is traceable to a specific staff/admin account.
- Rotate credentials (JWT secret, API keys) if a developer with access leaves the project.

---

## 7. Testing Strategy

### 7.1 Unit testing
- **Backend logic** — the calculations that matter most for correctness are the ledger/billing math: estimated vs. final amount, running balance updates, partial payments, aging calculations. These should have dedicated unit tests (Jest or Mocha) that exercise edge cases directly — a ₹0 order, a fully-paid monthly balance, a partial payment that doesn't fully clear a balance, an amount revision after partial payment already happened.
- **Mobile components** — form validation (garment quantity steppers, phone number fields), status-track rendering, and role-gated UI (making sure a staff-role view never renders an admin-only button) are worth component-level tests (Jest + React Native Testing Library), not just manual eyeballing.
- Aim for meaningful coverage of the billing/ledger logic specifically, rather than a blanket coverage percentage target — that's where a silent bug costs the client real money.

### 7.2 Integration testing
- Razorpay: test against Razorpay's sandbox/test-mode environment (test API keys, test UPI/card numbers) — never test payment flows against the live merchant account.
- WhatsApp/SMS: most providers (Twilio included) offer a sandbox number for development — verify both channels actually fire together (per the dual-send requirement) before this reaches real customers.
- Database transactions — specifically, that a payment update and its corresponding ledger entry either both succeed or both roll back together; a payment recorded without updating the ledger (or vice versa) is exactly the kind of bug that causes billing disputes later.

### 7.3 QA / manual testing
- Test on both Android and iOS, on at least one lower-end Android device — most staff-facing apps in this space run on budget phones, not the newest flagship.
- Explicitly test poor-connectivity scenarios (staff in a basement/parking area, per the earlier risk note) — does the app queue an order update and sync later, or does it just fail silently?
- Walk through the full order lifecycle end to end at least once per test cycle: pickup → garment entry → estimate → (optional) admin revision → delivery → payment (both QR and cash paths) → receipt — not just each screen in isolation.

---

## 8. User Acceptance Testing (UAT)

UAT is where the client (not your team) confirms the app actually does what they asked for, in their own words — this should be a structured process, not an informal "does this look okay?" conversation.

- **Define acceptance criteria up front**, tied directly back to the confirmed requirements (e.g. "Admin can revise an order's amount and the customer receives both a WhatsApp and SMS message with the revised amount and reason" is a testable, pass/fail criterion — "billing works properly" is not).
- **Run a pilot at one branch first**, with real staff using the app for actual pickups over a short period (1–2 weeks is typical) before wider rollout — this surfaces real-world friction (garment names staff actually use, how long entry takes on-site, network conditions) that a demo environment won't.
- **Get written sign-off from the client** once UAT criteria are met, before considering the project "done" — this protects both sides if a dispute comes up later about whether a feature was delivered as agreed.
- Keep a simple UAT tracking sheet (criterion → tested by → pass/fail → notes) — doesn't need to be elaborate, but having it in writing is worth far more than a verbal "looks good."

---

## 9. Deployment — What You're Actually Responsible For

Since you're handling deployment for the client, here's the full picture of accounts, costs, and steps involved. Treat this as a checklist to work through, roughly in this order.

### 9.1 Accounts you'll need to set up (decide ownership first — see 9.5)

| Account | Cost | Who typically owns it |
|---|---|---|
| Apple Developer Program | $99/year (individual or org) | Usually the **client**, so the app is published under their name |
| Google Play Console | $25 one-time | Usually the **client** |
| Database hosting (Supabase, to start) | Free tier initially | Either — easy to transfer later since it's just a Postgres connection string |
| Backend hosting (see 6.3) | Free–$25/month tier initially | Either |
| Razorpay merchant account | Free to create, transaction fees apply | Must be the **client** — it's their money moving through it, and KYC/settlement is tied to their business entity |
| WhatsApp Business API / Twilio | Free tier / usage-based | Either, but the WhatsApp number and business verification must match the **client's** registered business |
| Firebase project (push notifications) | Free tier | Either |

### 9.2 Mobile app store submission

**Google Play (do this one first — faster, cheaper, good for early testing):**
1. Create/access the Google Play Console account ($25 one-time fee, paid once).
2. Complete identity verification (ID/passport) and payment profile setup.
3. For an **organization account** (recommended for a client's business app), you'll need a D-U-N-S number — request this free from Dun & Bradstreet, but budget 1–2 weeks lead time, so start this early.
4. Personal accounts require a closed test with 12 testers for 14 days before general release — factor this into your launch timeline even if you go the personal-account route.
5. Build a signed Android App Bundle (`.aab`), upload via Play Console, fill in store listing (screenshots, description, privacy policy link, content rating questionnaire).
6. Submit for review — typically hours to about a day for Google, much faster than Apple.

**Apple App Store:**
1. Enroll in the Apple Developer Program — $99/year for individual, or the same $99/year for an organization (D-U-N-S number also required for org accounts, same lead-time note as above).
2. Set up App Store Connect, create the app listing, prepare screenshots and metadata.
3. Build and archive the app in Xcode, upload via Xcode or the Transporter tool.
4. Apple review typically takes 1–3 business days, but budget extra time for a first submission — apps handling payments and personal data (addresses, phone numbers) sometimes get closer scrutiny.
5. Common rejection triggers to avoid on the first pass: incomplete/placeholder content, missing privacy policy link, no demo login credentials provided for reviewers, and (as of 2026) apps must be built with the current iOS SDK — check the latest minimum SDK requirement in App Store Connect before submitting, since Apple updates this periodically.
6. Since staff/admin log in with phone + OTP, **provide App Review with a working demo account and OTP bypass** (or a fixed test OTP) so reviewers can actually get past login — this is one of the most common rejection reasons for OTP-gated apps.

### 9.3 Backend hosting

For the Node.js/Express API itself (separate from the database, which is already planned on Supabase):
- **Simple, budget-friendly options for a small first deployment:** Render or Railway — both support Node.js deploys directly from a GitHub repo, have free/low-cost starter tiers, and handle SSL certificates automatically.
- Set environment variables (database connection string, Razorpay keys, WhatsApp/Twilio credentials, JWT secret) through the hosting platform's dashboard — **never commit these to the repository**.
- Point a custom domain or subdomain (e.g. `api.peachandblue.in`) at the backend once it's stable — cleaner for the client and easier to migrate later than a raw platform-generated URL.

### 9.4 Environment & secrets checklist
- Separate environment variables for **development** and **production** — don't test against the production database.
- Rotate the JWT signing secret and any API keys if a developer who had access leaves the project.
- Store the Razorpay API keys, WhatsApp/Twilio credentials, and database URL only in the hosting platform's secret manager, not in code or in this document.

### 9.5 Ownership — decide this with the client explicitly, in writing
This is as much a business decision as a technical one, and it's worth resolving before you submit anything:
- **App store accounts (Apple/Google) should be registered under the client's business name**, not yours. If you register them under your own developer account "to save time," transferring ownership later is a slow, sometimes painful process (Apple in particular makes app-transfer between developer accounts a multi-step, multi-week process). Set it up correctly the first time.
- **Razorpay must be the client's account** — you're a vendor building the app, not the merchant of record for their laundry business.
- For infrastructure you're managing on their behalf (backend hosting, database, WhatsApp API), agree with the client up front whether **you retain admin access as an ongoing arrangement** (common if you're providing maintenance) or whether ownership fully transfers to them at project handoff. Put this in the contract, not just a verbal understanding — same principle as the NIVENXA branding clause from the original scope document.

### 9.6 Monitoring, backups, and ongoing maintenance
- Enable automated daily backups on the Postgres database (Supabase includes this on paid tiers; free tier has more limited backup retention — worth upgrading once the client is live with real customer data, since ledger/payment data loss would be a serious problem).
- Set up basic uptime monitoring on the backend (even a free tool like UptimeRobot pinging a health-check endpoint) so you know if the API goes down before the client tells you.
- Budget for ongoing maintenance — OS-level app updates (Android/iOS SDK changes), dependency updates, and bug fixes are normal and expected; a common industry rule of thumb is roughly 10–20% of the original build cost per year in maintenance, worth setting expectations with the client on this now rather than after launch.

---

## 10. Suggested Deployment Timeline

| Step | Timing relative to launch |
|---|---|
| Register Google Play + Apple Developer accounts (client's name) | Start immediately — D-U-N-S number lookup alone can take 1–2 weeks |
| Set up Razorpay merchant account (client's KYC) | Start in parallel — bank/KYC verification takes time |
| Backend + database deployed to staging | Once core API is feature-complete |
| WhatsApp Business API application | Start in parallel with development — this was flagged as the biggest schedule risk in the original planning pack |
| Internal testing (staff using real garment data) | 1–2 weeks before intended launch |
| Google Play submission | Submit first — faster review, catches obvious issues before Apple |
| Apple submission | Submit once Play Store build is stable |
| Go-live | After both stores approve, or Android-first if Apple review is delayed |

---

*This document assumes the schema and workflow already confirmed in prior planning docs. Update the API list once actual endpoint naming is finalized during backend development.*
