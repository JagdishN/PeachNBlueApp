# MSG91 template definitions — paste real data here

Why this folder exists: every "language" value in `src/constants/msg91Templates.ts`
except `otpLogin` is currently an **unverified guess** (`'en'`). Guessing has already
caused silent non-delivery once for `account_login` (real approved language turned
out to be `en_US`, not `en`) — see CLAUDE.md "Live send verification". Don't repeat
that for the other 9 templates.

## How to fill a file in

For each template, pull its real definition directly from MSG91 and paste the raw
JSON response into the matching file below — replace the whole placeholder object,
don't merge into it.

```
POST https://control.msg91.com/api/v5/whatsapp/get-template-curl/is_bulk/
Header: authkey: <your MSG91_AUTH_KEY>
Body:   { "name": "<the exact template name below>", "integrated_number": "917013725151" }
```

(Same endpoint/method already used to pull `account_login`'s real definition — see
CLAUDE.md's "Second follow-up" note under "Live send verification".)

## Files → real Meta template name

| File | Internal key (`msg91Templates.ts`) | Real Meta template name | Notes |
|---|---|---|---|
| `otpLogin.json` | `otpLogin` | `account_login` | Already reconciled into code (`language: 'en_US'`, `requiresOtpButton: true`) — paste anyway so it's on record here too, not just in comments. |
| `pickupConfirmation.json` | `pickupConfirmation` | `pickup_confirmation` | Was "under review" as of 2026-09-02 — check current status when you pull this. |
| `invoiceReady.json` | `invoiceReady` | `pb_invoice_ready` | Placeholder name only — no real template created/approved yet. Leave empty until one exists. |
| `amountRevision.json` | `amountRevision` | `amount_revision_notice` | |
| `invoiceReissued.json` | `invoiceReissued` | `invoice_reissued` | Has a URL button component. |
| `paymentReceipt.json` | `paymentReceipt` | `payment_receipt` | Variable order is name, amount, order#, method — not the usual order. |
| `paymentReminder.json` | `paymentReminder` | `payment_reminder` | |
| `deliveryConfirmation.json` | `deliveryConfirmation` | `delivery_confirmation` | Has a URL button component. |
| `monthlyStatementReady.json` | `monthlyStatementReady` | `monthly_statement_ready` | Confirmed real and deliverable — this is the one that arrived from a dashboard-composed send on 2026-09-02. |
| `adminPickupNotification.json` | `adminPickupNotification` | `pb_admin_pickup_notification` | Approval status unknown — not in the client's approved-templates doc at all. |

## Once a file has real data

Tell Claude (or update `src/constants/msg91Templates.ts` yourself) so the
`language` field for that template stops being an unverified guess, and so any
button/header component shape it reveals gets checked against what
`src/lib/msg91Client.ts` actually sends.
