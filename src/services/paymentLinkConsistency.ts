import prisma from '../prisma/client';
import { fetchPaymentLink } from '../lib/razorpayClient';
import { getInvoicePaymentSummary } from './paymentLedgerService';

// Payment-safety corrections (2026-11-01) — scheduled hourly alongside the
// existing 10-minute recoverStuckTransitions (src/jobs/index.ts). That job
// only finds invoices with an actual stuck PaymentLinkTransition row; this
// one catches a payment-link state that's inconsistent with the invoice's
// outstanding balance even when no transition was ever created at all.
//
// Read + flag only, never a fix: never waives a balance, never creates a
// duplicate Payment, never cancels/creates/replaces a Razorpay link on its
// own initiative. Any actual fix stays a deliberate human action via the
// mobile Resend Link / Payment Received buttons.

const hasOpenInconsistencyException = async (invoiceId: string): Promise<boolean> => {
  const existing = await prisma.paymentReconciliationException.findFirst({
    where: { invoiceId, exceptionType: 'payment_link_inconsistent', status: 'open' },
  });
  return !!existing;
};

const flagInconsistency = async (invoiceId: string, customerId: string, note: string): Promise<boolean> => {
  try {
    await prisma.paymentReconciliationException.create({
      data: {
        invoiceId,
        customerId,
        exceptionType: 'payment_link_inconsistent',
        collectedPaise: 0n,
        allocatedPaise: 0n,
        excessPaise: 0n,
        relatedPaymentIds: [],
        status: 'open',
        resolutionNotes: note,
      },
    });
    return true;
  } catch (err) {
    console.error(`[paymentLinkConsistency] Failed to persist payment_link_inconsistent exception for invoice ${invoiceId}:`, err);
    return false;
  }
};

const ACTIVE_LINK_STATUSES_DONE = ['paid', 'cancelled', 'expired'];

export const checkPaymentLinkConsistency = async (): Promise<{ flagged: number; checked: number }> => {
  let flagged = 0;
  let checked = 0;

  // Case 1: outstanding > 0, no valid link — no razorpayPaymentLinkId at
  // all, or local status already says cancelled/expired. Pure DB query.
  const missingLinkInvoices = await prisma.invoice.findMany({
    where: {
      order: { billingMode: { not: 'monthly_billing' } },
      OR: [{ razorpayPaymentLinkId: null }, { paymentLinkStatus: { in: ['cancelled', 'expired'] } }],
    },
    include: { order: true },
  });

  for (const invoice of missingLinkInvoices) {
    checked += 1;
    const summary = await getInvoicePaymentSummary(prisma, invoice.id);
    if (summary.outstandingPaise <= 0n) continue;

    // The existing stuck-transition recovery already owns an in-progress
    // transition — don't double-flag while that's still being worked.
    const inProgressTransition = await prisma.paymentLinkTransition.findFirst({
      where: { invoiceId: invoice.id, status: { in: ['pending', 'cancelling_old_link', 'creating_new_link'] } },
    });
    if (inProgressTransition) continue;
    if (await hasOpenInconsistencyException(invoice.id)) continue;

    const flaggedOk = await flagInconsistency(
      invoice.id,
      invoice.order.customerId,
      `Invoice ${invoice.id} has an outstanding balance of ₹${Number(summary.outstandingPaise) / 100} but no valid Razorpay payment link (status: ${invoice.paymentLinkStatus ?? 'none'}). Use "Resend Link" to issue one.`
    );
    if (flaggedOk) flagged += 1;
  }

  // Cases 2 & 3 both require live verification — never assumed from the
  // local DB alone — and only run against invoices whose local status
  // still says 'created' (an invoice already caught by case 1 above is
  // excluded here, so it's never double-processed).
  const invoicesWithActiveLocalLink = await prisma.invoice.findMany({
    where: {
      order: { billingMode: { not: 'monthly_billing' } },
      razorpayPaymentLinkId: { not: null },
      paymentLinkStatus: 'created',
    },
    include: { order: true },
  });

  for (const invoice of invoicesWithActiveLocalLink) {
    checked += 1;
    if (await hasOpenInconsistencyException(invoice.id)) continue;

    const summary = await getInvoicePaymentSummary(prisma, invoice.id);
    const fetchResult = await fetchPaymentLink(invoice.razorpayPaymentLinkId!);
    // Couldn't verify right now (network/API issue) — try again next run
    // rather than flag or assume anything from the possibly-stale local row.
    if (!fetchResult.success) continue;

    const liveStillPayable = !ACTIVE_LINK_STATUSES_DONE.includes(fetchResult.status ?? '');

    if (summary.outstandingPaise <= 0n) {
      // Case 2: fully settled locally, but Razorpay says the link is still open.
      if (liveStillPayable) {
        const flaggedOk = await flagInconsistency(
          invoice.id,
          invoice.order.customerId,
          `Invoice ${invoice.id} is fully settled, but its Razorpay payment link (${invoice.razorpayPaymentLinkId}) is still live on Razorpay's side (status: ${fetchResult.status}). A customer could still pay it — verify and cancel manually.`
        );
        if (flaggedOk) flagged += 1;
      }
      continue;
    }

    // Case 3: partially settled, active link's amount doesn't match current outstanding.
    if (liveStillPayable && fetchResult.amount !== Number(summary.outstandingPaise)) {
      const flaggedOk = await flagInconsistency(
        invoice.id,
        invoice.order.customerId,
        `Invoice ${invoice.id}'s active Razorpay link amount (₹${(fetchResult.amount ?? 0) / 100}) does not match its current outstanding balance (₹${Number(summary.outstandingPaise) / 100}). Use "Resend Link" to issue a corrected one.`
      );
      if (flaggedOk) flagged += 1;
    }
  }

  return { flagged, checked };
};
