// Every business-initiated WhatsApp message (OTP, pickup confirmation,
// amount revisions, etc.) requires a pre-approved Meta message template —
// a platform rule, not an MSG91 limitation. The free-form interpolated
// text bodies this codebase used under the old Twilio Sandbox integration
// are no longer possible outside a live 24-hour customer-service reply
// window. See CLAUDE.md "Messaging migration — MSG91, WhatsApp-only".
//
// `name` values below are PLACEHOLDERS — create a matching template in
// Meta Business Manager (via the MSG91 panel) for each one, with exactly
// this many {{n}} body variables in this order, before any of this can
// actually send. Update `name` here if Meta approves it under a different
// name than proposed. Money/quantity variables are passed as plain
// strings (e.g. "499", not "₹499") — the ₹ symbol and all other
// surrounding wording belongs in the template's own fixed text, not the
// variable value.
export const MSG91_TEMPLATES = {
  // {{1}} OTP code
  otpLogin: { name: 'pb_otp_login', variableCount: 1 },
  // {{1}} order number, {{2}} estimated amount — turnaround time (24-48h)
  // is fixed template text, not a variable.
  pickupConfirmation: { name: 'pb_pickup_confirmation', variableCount: 2 },
  // {{1}} order number, {{2}} amount, {{3}} payment-info line (either
  // "Pay online: <link>" or "This will be settled via your monthly
  // statement." — computed by the caller, since template TEXT can't
  // itself branch). Sent with a document header (the invoice PDF).
  invoiceReady: { name: 'pb_invoice_ready', variableCount: 3 },
  // {{1}} order number, {{2}} new amount, {{3}} reason (mandatory —
  // CLAUDE.md non-negotiable, same text shown to the customer)
  amountRevision: { name: 'pb_amount_revision', variableCount: 3 },
  // {{1}} order number, {{2}} amount, {{3}} payment-info line (same
  // convention as invoiceReady). Sent with a document header.
  invoiceReissued: { name: 'pb_invoice_reissued', variableCount: 3 },
  // {{1}} order number, {{2}} amount paid, {{3}} payment method label
  paymentReceipt: { name: 'pb_payment_receipt', variableCount: 3 },
  // {{1}} outstanding balance
  paymentReminder: { name: 'pb_payment_reminder', variableCount: 1 },
  // {{1}} location label, {{2}} order number, {{3}} estimated amount —
  // internal, sent to admin User rows, not a customer (CLAUDE.md order
  // workflow item 4a).
  adminPickupNotification: { name: 'pb_admin_pickup_notification', variableCount: 3 },
} as const;
