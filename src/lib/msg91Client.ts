import { MSG91_AUTH_KEY, MSG91_INTEGRATED_NUMBER } from '../config';

const MSG91_WHATSAPP_ENDPOINT = 'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/';

// ⚠️ UNVERIFIED AGAINST A LIVE ACCOUNT — read before touching.
// MSG91's real WhatsApp API reference is auth-walled / marketing-only from
// this environment: their public docs pages (docs.msg91.com/whatsapp/*,
// msg91.com/help/...) don't expose the actual endpoint/request contract,
// and api.msg91.com itself 401s without a real authkey. Unlike the
// Razorpay webhook work earlier this project (verified directly against
// fetched docs), this request shape is built from MSG91's commonly
// published v5 WhatsApp template-message examples — NOT fetched/confirmed
// here. Before relying on this: use MSG91's dashboard test-send tool (or a
// real send) against a real authkey + integrated number + approved
// template, and correct this file's body shape if the real API rejects it
// or responds differently than assumed below.
export interface Msg91TemplateMessage {
  toPhoneNumber: string;
  // The sending branch's own MSG91-integrated WhatsApp number (CLAUDE.md
  // "Branches") — resolved by the caller via resolveWhatsappFrom, not
  // defaulted here.
  fromNumber: string;
  templateName: string;
  // Positional — mapped to body_1, body_2, ... in template variable order.
  // WhatsApp templates only allow variable VALUES to be dynamic, never the
  // surrounding template text itself (a Meta platform rule, not
  // MSG91-specific) — see src/constants/msg91Templates.ts.
  bodyVariables: string[];
  // Only for templates created with a document header component (e.g. the
  // invoice PDF) — omit for templates with no header.
  headerMediaUrl?: string;
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
  bodyVariables,
  headerMediaUrl,
}: Msg91TemplateMessage): Promise<void> => {
  const components: Record<string, unknown> = Object.fromEntries(
    bodyVariables.map((value, index) => [`body_${index + 1}`, { type: 'text', value }])
  );

  if (headerMediaUrl) {
    components.header_1 = { type: 'document', value: headerMediaUrl };
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
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en', policy: 'deterministic' },
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
