import { CommunicationMessageType } from '../types/enums';
import prisma from '../prisma/client';
import { sendWhatsAppTemplate, formatMsg91Error, resolveWhatsappFrom } from '../lib/msg91Client';

interface NotifiableCustomer {
  id: string;
  // Required — the primary number, always sent to. alternativePhoneNumber
  // and secondaryPhoneNumber below are optional additional recipients, not
  // overrides (renamed/added 2026-10-30, client request: every WhatsApp
  // notification should reach every number a customer has on file, not just
  // whichever single one used to win).
  phoneNumber: string;
  alternativePhoneNumber: string | null;
  secondaryPhoneNumber: string | null;
  // The customer's own branch's WhatsApp number — this is the SENDING
  // number (CLAUDE.md: each branch sends from its own registered number),
  // not a second recipient number. Required, not optional: every real
  // caller reaches this via customerSelectForRole or an explicit include
  // that always joins branch.whatsappNumber now, so a missing branch here
  // signals a caller that forgot to include it, not a legitimate null case.
  branch: { whatsappNumber: string | null };
}

interface TemplateMessage {
  name: string;
  // The template's real approved language (e.g. "en", "en_US") — see
  // msg91Client.ts's Msg91TemplateMessage.language for why this matters and
  // isn't just cosmetic. Callers should pass src/constants/msg91Templates.ts's
  // `language` field for the template being sent, not hardcode this.
  language?: string;
  // Positional — see src/constants/msg91Templates.ts for each template's
  // variable order/meaning.
  bodyVariables: string[];
  // Only for templates with a header media component — omit for templates
  // with no header. See msg91Client.ts's Msg91TemplateMessage.headerType for
  // "document" (e.g. the invoice PDF) vs "image" (e.g. delivery_confirmation's
  // fixed background image) — defaults to "document" if omitted.
  headerMediaUrl?: string;
  headerType?: 'document' | 'image';
  // Only for templates with a dynamic-URL button component — see
  // msg91Client.ts's Msg91TemplateMessage.buttonUrlParam.
  buttonUrlParam?: string;
}

// Sends a customer notification over WhatsApp — the only channel now
// (CLAUDE.md "Messaging migration — MSG91, WhatsApp-only": SMS is no
// longer sent anywhere). One communications_log row per call (not one per
// recipient) — 'sms' remains a valid value in the DB's channel CHECK
// constraint for historical rows but is never written by this codebase
// anymore (see CLAUDE.md for why the constraint itself was left as-is
// rather than altered).
//
// Fans out to every number the customer has on file (2026-10-30, client
// request) — phoneNumber (required) plus alternativePhoneNumber and
// secondaryPhoneNumber (both optional), deduped, rather than the old
// single-target logic (whatsappNumber as an override, falling back to
// phoneNumber). Each recipient is sent independently (a failure on one
// number doesn't block the others) — the logged status is 'sent' if at
// least one recipient received it, 'failed' only if every one did.
export const sendNotification = async (
  customer: NotifiableCustomer,
  messageType: CommunicationMessageType,
  template: TemplateMessage,
  orderId?: string
): Promise<void> => {
  const fromNumber = resolveWhatsappFrom(customer.branch.whatsappNumber);
  const targets = Array.from(
    new Set(
      [customer.phoneNumber, customer.alternativePhoneNumber, customer.secondaryPhoneNumber].filter(
        (n): n is string => Boolean(n)
      )
    )
  );

  const results = await Promise.allSettled(
    targets.map((toPhoneNumber) =>
      sendWhatsAppTemplate({
        toPhoneNumber,
        fromNumber,
        templateName: template.name,
        language: template.language,
        bodyVariables: template.bodyVariables,
        headerMediaUrl: template.headerMediaUrl,
        headerType: template.headerType,
        buttonUrlParam: template.buttonUrlParam,
      })
    )
  );

  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(
        `Failed to send ${messageType} via WhatsApp to customer ${customer.id} (${targets[i]}): ${formatMsg91Error(result.reason)}`
      );
    }
  });

  const status: 'sent' | 'failed' = results.some((r) => r.status === 'fulfilled') ? 'sent' : 'failed';

  await prisma.communicationLog.create({
    data: {
      customerId: customer.id,
      orderId,
      messageType,
      channel: 'whatsapp',
      status,
    },
  });
};

interface NotifiableAdmin {
  id: string;
  phoneNumber: string;
}

// Distinct from sendNotification above: this targets internal admin User
// rows, not a customer, so it doesn't write to communications_log (that
// table is customer-scoped via a required customerId FK — same reasoning
// push notifications via pushService.ts already don't log there either).
//
// Generalized (2026-10-30) from the original notifyAdminsOfPickup — the
// pickup, delivery, and payment admin notifications all reuse the matching
// customer-facing template (CLAUDE.md "Admin template reuse" — no new
// Meta-approved template needed), so this now passes through the full
// TemplateMessage shape (header/button components included), not just
// bodyVariables.
export const notifyAdmins = async (
  admins: NotifiableAdmin[],
  template: TemplateMessage,
  fromNumber: string
): Promise<void> => {
  const results = await Promise.allSettled(
    admins.map((admin) =>
      sendWhatsAppTemplate({
        toPhoneNumber: admin.phoneNumber,
        fromNumber,
        templateName: template.name,
        language: template.language,
        bodyVariables: template.bodyVariables,
        headerMediaUrl: template.headerMediaUrl,
        headerType: template.headerType,
        buttonUrlParam: template.buttonUrlParam,
      })
    )
  );

  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(
        `Failed to send admin notification via WhatsApp to admin ${admins[i].id}: ${formatMsg91Error(result.reason)}`
      );
    }
  });
};
