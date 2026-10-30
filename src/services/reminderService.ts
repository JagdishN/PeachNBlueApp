import prisma from '../prisma/client';
import { sendWhatsAppTemplate, formatMsg91Error, resolveWhatsappFrom } from '../lib/msg91Client';
import { MSG91_TEMPLATES } from '../constants/msg91Templates';
import { getCustomerOutstandingSummary } from './outstandingService';

// Outstanding-dues rework, sections 7-9 — admin-only WhatsApp payment
// reminders for a customer's per-order invoices. Deliberately NOT built on
// ledgerService.ts::sendReminder, which is the monthly-billing customer's
// running-balance reminder — a genuinely different financial model (Phase
// 1 audit finding) with no per-invoice concept at all. This file is the
// per-invoice/per-customer-outstanding equivalent.
//
// Ships now on the REAL approved `payment_reminder` template as it exists
// today — {{1}} name, {{2}} total outstanding, no button, no itemized
// line items (client decision, 2026-10-30: ship on the existing template
// rather than hold the feature for a Meta resubmission). The admin still
// sees the full itemized breakdown when previewing in the app before
// sending (see outstandingController.ts's GET .../outstanding) — only the
// WhatsApp message itself is limited to the total.

const DUPLICATE_WINDOW_HOURS = 24;

export interface SendReminderInput {
  customerId: string;
  adminId: string;
  // Specific invoice IDs to remind about; omit or pass an empty array for
  // "combined" (every currently-outstanding invoice for this customer).
  invoiceIds?: string[];
  overrideDuplicateWarning?: boolean;
}

export interface SendReminderResult {
  reminderId: string;
  outstandingAtSend: number;
  recipientPhoneNumbers: string[];
  deliveryStatus: 'sent' | 'partial' | 'failed';
}

const makeError = (message: string, status: number, extra?: Record<string, unknown>): Error => {
  const err = new Error(message) as Error & Record<string, unknown>;
  err.status = status;
  if (extra) Object.assign(err, extra);
  return err;
};

export const sendPaymentReminder = async (input: SendReminderInput): Promise<SendReminderResult> => {
  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    include: { branch: { select: { whatsappNumber: true } } },
  });
  if (!customer) {
    throw makeError('Customer not found.', 404);
  }

  // "Before sending, recalculate the current balance and validate the
  // payment request" — always a live re-read, never a cached/stale figure
  // the admin might have been looking at for a while before pressing Send.
  const outstanding = await getCustomerOutstandingSummary(input.customerId);
  const targetRows =
    input.invoiceIds && input.invoiceIds.length > 0
      ? outstanding.invoices.filter((row) => input.invoiceIds!.includes(row.invoiceId) && row.outstanding > 0)
      : outstanding.invoices.filter((row) => row.outstanding > 0);

  if (targetRows.length === 0) {
    throw makeError('This customer has nothing currently outstanding to remind about.', 400);
  }

  // "If a payment is pending verification or provider reconciliation, warn
  // the Admin and prevent sending an inaccurate payment demand." — a
  // pending bank_upi report means the REAL outstanding figure might be
  // about to drop once verified; sending now risks demanding money that's
  // (probably) already on its way to being accounted for.
  const pendingUpi = await prisma.payment.findFirst({
    where: { invoiceId: { in: targetRows.map((row) => row.invoiceId) }, paymentSource: 'bank_upi', verificationStatus: 'pending' },
  });
  if (pendingUpi) {
    throw makeError(
      'A bank UPI payment for one of these invoices is still awaiting verification — resolve it first, or the amount demanded in this reminder may be wrong.',
      409,
      { code: 'PENDING_VERIFICATION' }
    );
  }

  // "Warn when a reminder was sent within the previous 24 hours... An
  // Admin may override... with explicit confirmation."
  if (!input.overrideDuplicateWarning) {
    const since = new Date(Date.now() - DUPLICATE_WINDOW_HOURS * 60 * 60 * 1000);
    const recent = await prisma.paymentReminderLog.findFirst({
      where: { customerId: input.customerId, sentAt: { gte: since } },
      orderBy: { sentAt: 'desc' },
    });
    if (recent) {
      throw makeError(
        `A reminder was already sent to this customer at ${recent.sentAt.toISOString()} — pass overrideDuplicateWarning to send again anyway.`,
        409,
        { code: 'DUPLICATE_REMINDER', lastSentAt: recent.sentAt }
      );
    }
  }

  const totalOutstanding = targetRows.reduce((sum, row) => sum + row.outstanding, 0);
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
        templateName: MSG91_TEMPLATES.paymentReminder.name,
        language: MSG91_TEMPLATES.paymentReminder.language,
        bodyVariables: [customer.fullName, String(totalOutstanding)],
      })
    )
  );

  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`Failed to send payment reminder to customer ${customer.id} (${targets[i]}): ${formatMsg91Error(result.reason)}`);
    }
  });

  // Prisma scalar list columns (String[]) don't support a null element the
  // way a raw Postgres text[] would — '' is the "no id, this one failed"
  // placeholder, kept parallel (same index) with recipientPhoneNumbers so
  // which number got which id (or failed) is still reconstructable.
  const providerMessageIds = results.map((result) => (result.status === 'fulfilled' ? result.value.messageId ?? '' : ''));
  const succeededCount = results.filter((result) => result.status === 'fulfilled').length;
  const deliveryStatus: SendReminderResult['deliveryStatus'] =
    succeededCount === targets.length ? 'sent' : succeededCount > 0 ? 'partial' : 'failed';

  const log = await prisma.paymentReminderLog.create({
    data: {
      customerId: input.customerId,
      sentById: input.adminId,
      invoiceIds: targetRows.map((row) => row.invoiceId),
      outstandingAtSendPaise: BigInt(Math.round(totalOutstanding * 100)),
      recipientPhoneNumbers: targets,
      templateName: MSG91_TEMPLATES.paymentReminder.name,
      providerMessageIds,
      deliveryStatus,
      failureReason: deliveryStatus === 'failed' ? 'All recipients failed' : deliveryStatus === 'partial' ? 'Some recipients failed' : null,
    },
  });

  return {
    reminderId: log.id,
    outstandingAtSend: totalOutstanding,
    recipientPhoneNumbers: targets,
    deliveryStatus,
  };
};

// "See the last reminder date and history" — admin-only (enforced at the
// route layer).
export const listReminderHistory = (customerId: string) =>
  prisma.paymentReminderLog.findMany({
    where: { customerId },
    orderBy: { sentAt: 'desc' },
  });
