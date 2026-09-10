// Every business-initiated WhatsApp message (OTP, pickup confirmation,
// amount revisions, etc.) requires a pre-approved Meta message template —
// a platform rule, not an MSG91 limitation. The free-form interpolated
// text bodies this codebase used under the old Twilio Sandbox integration
// are no longer possible outside a live 24-hour customer-service reply
// window. See CLAUDE.md "Messaging migration — MSG91, WhatsApp-only" and
// "Approved WhatsApp Templates — Final" (2026-09-02).
//
// Money/quantity variables are passed as plain strings (e.g. "499", not
// "₹499") — the ₹ symbol and all other surrounding wording belongs in the
// template's own fixed text, not the variable value.
//
// `language` matters and is NOT cosmetic — confirmed 2026-09-02 ("Live send
// verification"): `account_login`'s real approved language turned out to be
// "en_US", not the bare "en" every template here defaults to. Sending the
// wrong language code is a plausible reason MSG91 can return
// status: "success" while Meta silently drops delivery. Every entry below
// EXCEPT otpLogin still has `language: 'en'` as an UNVERIFIED guess — pull
// each template's real definition (same way otpLogin's was found) before
// fully trusting a send against it.
export const MSG91_TEMPLATES = {
  // {{1}} OTP code. Real Meta-approved name, confirmed 2026-09-02 (CLAUDE.md
  // "Non-negotiables" — Authentication category, the rebuilt WABA's real
  // OTP milestone; replaces the earlier Utility-category workaround that
  // caused the permanent ban documented there). Confirmed as "account_login"
  // directly by the client, not assumed — a note pasted earlier this same
  // day said "account_verification" instead, which was wrong.
  //
  // Both `language` and `requiresOtpButton` below came from pulling this
  // template's real definition directly from MSG91 (2026-09-02, "Live send
  // verification"), after every OTP test send failed silently despite
  // MSG91 returning status: "success":
  // - language is "en_US", NOT the bare "en" msg91Client.ts used to send
  //   unconditionally for every template.
  // - the template has a mandatory BUTTONS component (Meta's OTP "Copy
  //   Code" one-tap autofill) — its {{1}} is the OTP code itself (same
  //   value as body_1, not a link), submitted the same way as the
  //   Razorpay-link buttons (component subtype "url"). Confirmed shape:
  //   `variables: ["body_1", "button_1"]`,
  //   `variable_type: { body_1: { type: "text" }, button_1: { subtype: "url", type: "text" } }`.
  //   otpService.ts must pass the OTP code as BOTH bodyVariables[0] AND
  //   buttonUrlParam — omitting the button is plausibly why every OTP test
  //   before this fix failed even once the namespace bug was fixed.
  otpLogin: {
    name: 'account_login',
    variableCount: 1,
    status: 'approved' as const,
    language: 'en_US',
    requiresOtpButton: true,
  },

  // Real Meta-approved name/shape, confirmed 2026-09-02. Was briefly BACK
  // UNDER META REVIEW (resubmitted without a Header field) — **CONFIRMED
  // Active again directly by the client (2026-09-03)**, and confirmed via a
  // real human-received delivery (the OTP-flow test and the admin pickup
  // notification test both used this template and arrived). {{1}} customer
  // name, {{2}} order number, {{3}} estimated amount — turnaround time
  // (24-48h) is fixed template text, not a variable.
  pickupConfirmation: { name: 'pickup_confirmation', variableCount: 3, status: 'approved' as const, language: 'en' },

  // RESOLVED (2026-09-03): real template exists, name is `generate_invoice`
  // — client pulled its real definition (/msg91-templates/invoiceReady.json)
  // and confirmed it. {{1}} customer name, {{2}} order number, {{3}}
  // estimated amount; URL button (the payment link, suffix-only per Meta's
  // dynamic-URL mechanism — see utils/paymentLink.ts). No document-header
  // component — supersedes an earlier design note (in an old, stale
  // document re-pasted into this project) describing one; the real pulled
  // definition has none, so orderService.ts no longer attaches the invoice
  // PDF to this message (the PDF is still generated/stored regardless, per
  // the shared invoiceService.ts flow — just not attached here).
  invoiceReady: { name: 'generate_invoice', variableCount: 3, status: 'approved' as const, language: 'en', hasPaymentLinkButton: true },

  // Real Meta-approved name/shape, confirmed 2026-09-02 (Approved).
  // {{1}} customer name, {{2}} order number, {{3}} new amount, {{4}} reason
  // (mandatory — CLAUDE.md non-negotiable, same text shown to the
  // customer).
  amountRevision: { name: 'amount_revision_notice', variableCount: 4, status: 'approved' as const, language: 'en' },

  // Real Meta-approved name/shape, confirmed 2026-09-02 (Approved).
  // {{1}} customer name, {{2}} order number, {{3}} new amount. CORRECTED
  // (2026-09-03): originally assumed to carry the payment link via a URL
  // button component, but a real pulled definition
  // (/msg91-templates/invoiceReissued.json) showed only body_1/2/3, no
  // button — confirmed directly with the client ("I think I have not added
  // buttons"). invoiceReissue.service.ts now appends the link as plain text
  // onto the {{3}} value instead (`"${amount}. Pay online: ${url}"`) —
  // WhatsApp auto-links a plain-text URL, no button/resubmission needed.
  // Still no branch for "settled via monthly statement" — invoiceReissue
  // .service.ts skips sending entirely when the reissued invoice has no
  // real payment link (monthly-billing orders).
  invoiceReissued: { name: 'invoice_reissued', variableCount: 3, status: 'approved' as const, language: 'en' },

  // Real Meta-approved name/shape, confirmed 2026-09-02 (Approved). Note
  // the variable ORDER: {{1}} customer name, {{2}} amount paid, {{3}} order
  // number, {{4}} payment method — amount comes before order number here,
  // unlike every other template in this file.
  paymentReceipt: { name: 'payment_receipt', variableCount: 4, status: 'approved' as const, language: 'en' },

  // Real Meta-approved name/shape, confirmed 2026-09-02 (Approved).
  // {{1}} customer name, {{2}} outstanding balance.
  paymentReminder: { name: 'payment_reminder', variableCount: 2, status: 'approved' as const, language: 'en' },

  // Real Meta-approved name/shape, confirmed 2026-09-02 (Approved) — WIRED
  // (2026-09-02, "Razorpay/delivery_confirmation button wiring") into
  // orderService.ts::updateStatus's transition to 'delivered', but only
  // when order.paymentStatus !== 'paid' at that moment (confirmed via
  // AskUserQuestion, not guessed): the mobile app's normal flow bundles
  // recordPayment + this status update into one staff action, so payment
  // is usually already collected by the time this runs, and the approved
  // template's fixed text ("Amount due: Rs.{{3}}") would be factually
  // wrong to send in that case. Monthly-billing orders are excluded
  // entirely (no real payment link, same as invoiceReissued above).
  // {{1}} customer name, {{2}} order number, {{3}} amount due; URL button
  // (the payment link, suffix-only per Meta's dynamic-URL mechanism — see
  // utils/paymentLink.ts). RE-CORRECTED (2026-09-03): a pulled sample
  // briefly showed no button/header at all, and the link was moved to plain
  // body text as a result — the client then confirmed this template
  // genuinely does have both a real button_1 (the payment link) and a
  // header_1 (a fixed background image). Both are wired in orderService.ts.
  // RESOLVED (2026-09-03): header_1 turned out to be MANDATORY, not
  // decorative — a live send comparison confirmed the message never arrives
  // at all when header_1 is omitted (MSG91 still returns status: "success"
  // either way), same silent-drop-on-missing-component failure mode as the
  // missing-namespace/missing-OTP-button/wrong-endpoint bugs before it.
  // Client confirmed (after seeing a test send) using the Peach & Blue UPI
  // QR image itself as the permanent header — see
  // DELIVERY_CONFIRMATION_HEADER_IMAGE_URL in orderService.ts.
  // invoice_reissued was NOT reconfirmed the same way and still uses the
  // plain-text-in-body approach — don't assume it also has a button.
  deliveryConfirmation: { name: 'delivery_confirmation', variableCount: 3, status: 'approved' as const, language: 'en', hasPaymentLinkButton: true },

  // Real Meta-approved name/shape, confirmed 2026-09-02 (Approved) — but
  // NOT YET WIRED to any code path. Monthly billing/statements are not yet
  // an active, reachable feature (CLAUDE.md "Monthly billing + discount" —
  // toggles exist, no statement-generation job exists). Template is ready
  // for whenever that feature is actually built. {{1}} customer name,
  // {{2}} statement month/period, {{3}} total due.
  monthlyStatementReady: { name: 'monthly_statement_ready', variableCount: 3, status: 'approved' as const, language: 'en' },

  // adminPickupNotification (a separate placeholder template,
  // 'pb_admin_pickup_notification', never created/approved) was removed
  // 2026-09-03 per explicit client decision: the admin pickup notice now
  // reuses `pickupConfirmation` above instead of needing its own
  // Meta-approved template. See orderService.ts's admin-notification send
  // site — {{1}} carries the order's locationLabel in the slot the
  // customer-facing send uses for the customer's name, {{2}} order number,
  // {{3}} estimated amount, matching pickupConfirmation's 3-variable shape.
} as const;
