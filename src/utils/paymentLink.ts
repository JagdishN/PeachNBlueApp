// Meta's WhatsApp dynamic-URL button mechanism (a platform rule, not
// MSG91-specific) requires a FIXED base URL configured at template-creation
// time in Meta Business Manager — the runtime parameter is only the
// variable suffix appended to that base, never an arbitrary full URL. An
// earlier version of this codebase passed the whole Razorpay short link as
// the button value, which would double up the template's own base prefix
// and produce a broken button.
//
// Re-added 2026-09-03: deleted when invoice_reissued/delivery_confirmation
// were briefly believed to have no button component at all (a pulled sample
// showed neither) — the client then confirmed both were real (button_1 is
// the payment link, on delivery_confirmation at least; header_1 is a fixed
// background image, not a payment mechanism). Currently wired to
// delivery_confirmation and generate_invoice — see orderService.ts.
//
// CORRECTED (2026-09-03), confirmed via a real live send + a human tap:
// sending just the bare last segment (e.g. "xA7TkwF") produced a broken tap
// URL — "https://rzp.io/rzp/xA7TkwF" became "https://rzp.io/rzpxA7TkwF",
// missing the "/" between the template's configured base and the dynamic
// part. Meta's mechanism concatenates the suffix directly onto the base
// with NO separator inserted automatically — the base is configured as
// "https://rzp.io/rzp" (no trailing slash) and the suffix must supply its
// own leading "/". Fixed by prefixing the returned suffix with "/".
export const extractPaymentLinkSuffix = (paymentLinkUrl: string): string => {
  const segments = paymentLinkUrl.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? paymentLinkUrl;
  return `/${last}`;
};
