import { CommunicationMessageType } from '../types/enums';
import prisma from '../prisma/client';
import { sendWhatsAppTemplate, formatMsg91Error, resolveWhatsappFrom } from '../lib/msg91Client';

interface NotifiableCustomer {
  id: string;
  phoneNumber: string;
  whatsappNumber: string | null;
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
  // Only for templates with a document header component (e.g. the invoice
  // PDF) — omit for templates with no header.
  headerMediaUrl?: string;
  // Only for templates with a dynamic-URL button component — see
  // msg91Client.ts's Msg91TemplateMessage.buttonUrlParam.
  buttonUrlParam?: string;
}

// Sends a customer notification over WhatsApp — the only channel now
// (CLAUDE.md "Messaging migration — MSG91, WhatsApp-only": SMS is no
// longer sent anywhere). Each attempt writes one communications_log row —
// 'sms' remains a valid value in the DB's channel CHECK constraint for
// historical rows but is never written by this codebase anymore (see
// CLAUDE.md for why the constraint itself was left as-is rather than
// altered).
export const sendNotification = async (
  customer: NotifiableCustomer,
  messageType: CommunicationMessageType,
  template: TemplateMessage,
  orderId?: string
): Promise<void> => {
  const whatsappTarget = customer.whatsappNumber ?? customer.phoneNumber;
  const fromNumber = resolveWhatsappFrom(customer.branch.whatsappNumber);

  let status: 'sent' | 'failed' = 'sent';

  try {
    await sendWhatsAppTemplate({
      toPhoneNumber: whatsappTarget,
      fromNumber,
      templateName: template.name,
      language: template.language,
      bodyVariables: template.bodyVariables,
      headerMediaUrl: template.headerMediaUrl,
      buttonUrlParam: template.buttonUrlParam,
    });
  } catch (err) {
    status = 'failed';
    console.error(`Failed to send ${messageType} via WhatsApp to customer ${customer.id}: ${formatMsg91Error(err)}`);
  }

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
export const notifyAdminsOfPickup = async (
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
      })
    )
  );

  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(
        `Failed to send pickup notification via WhatsApp to admin ${admins[i].id}: ${formatMsg91Error(result.reason)}`
      );
    }
  });
};
