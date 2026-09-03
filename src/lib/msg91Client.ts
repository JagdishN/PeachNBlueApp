import { MSG91_AUTH_KEY, MSG91_INTEGRATED_NUMBER, MSG91_WABA_NAMESPACE } from '../config';

// VERIFIED against a real, authoritative MSG91 doc cURL example for this
// exact template (2026-09-02) — note the /bulk/ suffix. The endpoint
// WITHOUT it (used by every version of this file before this fix) silently
// accepts requests (status: "success") but never actually dispatches them —
// the real, functional endpoint has always been this one.
const MSG91_WHATSAPP_ENDPOINT = 'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';

// ✅ CONFIRMED DELIVERED (2026-09-03) for account_login specifically — see
// CLAUDE.md "Live send verification". Getting here took four rounds of
// MSG91 returning status: "success" while nothing actually arrived: a
// missing `namespace`, a wrong `language` code, a missing mandatory OTP
// button, and finally the actual root cause — the endpoint URL itself was
// wrong the entire time (missing a required /bulk/ suffix; the non-/bulk/
// endpoint silently accepts and "succeeds" without ever dispatching). The
// button_1 shape (`type: "text"`, `value` as a plain string) and the
// removal of `payload.to` were corrected against a real authoritative MSG91
// doc cURL example for this template.
//
// This confirms the request SHAPE below is correct. It does NOT confirm
// every template's `language`/component fields are right — only
// account_login's have been reconciled against a real pulled definition so
// far (see src/constants/msg91Templates.ts and /msg91-templates at the repo
// root). Treat any other template as unverified until its own real
// definition has been pulled and a send against it has been confirmed
// received on a real phone, the same way this one was — a "success"
// response alone was never reliable evidence for this integration.
export interface Msg91TemplateMessage {
  toPhoneNumber: string;
  // The sending branch's own MSG91-integrated WhatsApp number (CLAUDE.md
  // "Branches") — resolved by the caller via resolveWhatsappFrom, not
  // defaulted here.
  fromNumber: string;
  templateName: string;
  // The template's actual approved language code (e.g. "en", "en_US") —
  // VERIFIED to matter, not a cosmetic detail: `account_login`'s real
  // approved language is "en_US", confirmed 2026-09-02 by pulling its
  // template definition directly from MSG91, while this file previously
  // hardcoded a bare "en" for every send unconditionally. Sending the wrong
  // language code is a plausible reason a request can return MSG91
  // status: "success" while Meta still silently drops delivery — same
  // failure signature as the namespace bug above. Defaults to "en" only as
  // a fallback for callers that don't know better; real call sites should
  // pass whatever src/constants/msg91Templates.ts records for that
  // template, not rely on this default.
  language?: string;
  // Positional — mapped to body_1, body_2, ... in template variable order.
  // WhatsApp templates only allow variable VALUES to be dynamic, never the
  // surrounding template text itself (a Meta platform rule, not
  // MSG91-specific) — see src/constants/msg91Templates.ts.
  bodyVariables: string[];
  // Only for templates created with a document header component (e.g. the
  // invoice PDF) — omit for templates with no header.
  headerMediaUrl?: string;
  // Only for templates with a real BUTTONS component. CORRECTED
  // (2026-09-03): invoice_reissued/delivery_confirmation were originally
  // assumed to carry the Razorpay payment link via a dynamic-URL button —
  // confirmed against real pulled definitions (/msg91-templates) that
  // neither actually has one, so both now append the link as plain body
  // text instead (see msg91Templates.ts). The only current real user of
  // this field is otpLogin's mandatory "Copy Code" button (its value is the
  // OTP code itself, not a URL suffix — see otpService.ts). If a future
  // template genuinely does have a dynamic-URL button, Meta's mechanism
  // configures a FIXED base URL at template-approval time and only a
  // trailing suffix is left variable at send time — don't pass a full URL
  // here without checking that against the template's real definition
  // first, the way account_login's button param was verified.
  buttonUrlParam?: string;
}

export const formatMsg91Error = (err: unknown): string => {
  const msg91Err = err as { code?: string; message?: string } | undefined;
  if (msg91Err?.code !== undefined) {
    return `MSG91 error ${msg91Err.code}: ${msg91Err.message ?? 'no message'}`;
  }
  return err instanceof Error ? err.message : String(err);
};

export const sendWhatsAppTemplate = async ({
  toPhoneNumber,
  fromNumber,
  templateName,
  language,
  bodyVariables,
  headerMediaUrl,
  buttonUrlParam,
}: Msg91TemplateMessage): Promise<void> => {
  const components: Record<string, unknown> = Object.fromEntries(
    bodyVariables.map((value, index) => [`body_${index + 1}`, { type: 'text', value }])
  );

  if (headerMediaUrl) {
    components.header_1 = { type: 'document', value: headerMediaUrl };
  }

  if (buttonUrlParam) {
    // VERIFIED against a real, authoritative MSG91 doc cURL example for
    // account_login (2026-09-02) — type is "text" (not "button"), and value
    // is a plain string (not an array). Every earlier version of this file
    // sent { type: 'button', value: [buttonUrlParam] }, which was wrong on
    // both counts.
    components.button_1 = { subtype: 'url', type: 'text', value: buttonUrlParam };
  }

  const response = await fetch(MSG91_WHATSAPP_ENDPOINT, {
    method: 'POST',
    headers: {
      authkey: MSG91_AUTH_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      integrated_number: fromNumber,
      content_type: 'template',
      payload: {
        // CORRECTED (2026-09-02): a top-level `payload.to` was added
        // earlier after the WRONG endpoint (no /bulk/ suffix — see
        // MSG91_WHATSAPP_ENDPOINT above) 400'd without it. The real,
        // authoritative doc cURL example for the actual working /bulk/
        // endpoint has no such field — only `to_and_components[].to`
        // below. Removed to match the real documented contract exactly,
        // now that it's actually known rather than inferred.
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: templateName,
          language: { code: language ?? 'en', policy: 'deterministic' },
          // VERIFIED against a real live payload (2026-09-02, "Live send
          // verification — namespace fix"): omitting this is why every send
          // before this fix returned MSG91 status: "success" but never
          // actually delivered — a working dashboard-composed send included
          // it, an identical-looking API call without it silently failed.
          // The WABA's namespace GUID, same value for every template under
          // it — get it from MSG91's dashboard if it ever needs updating
          // (e.g. after another WABA rebuild).
          namespace: MSG91_WABA_NAMESPACE,
          to_and_components: [
            {
              to: [toPhoneNumber],
              components,
            },
          ],
        },
      },
    }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
    const err = new Error(errorBody?.message ?? `MSG91 request failed with status ${response.status}`) as Error & {
      code?: string;
    };
    err.code = String(response.status);
    throw err;
  }
};

// Single place the branch-number-vs-shared-fallback decision is made
// (CLAUDE.md "Branches") — every call site resolves it identically rather
// than duplicating the `?? MSG91_INTEGRATED_NUMBER` fallback inline.
export const resolveWhatsappFrom = (branchWhatsappNumber: string | null | undefined): string =>
  branchWhatsappNumber ?? MSG91_INTEGRATED_NUMBER;
