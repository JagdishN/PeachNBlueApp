import prisma from '../prisma/client';
import { fetchPaymentLink } from '../lib/razorpayClient';
import { getInvoicePaymentSummary, InvoicePaymentSummary } from './paymentLedgerService';
import { recordOnlinePayment } from './orderService';
import { mapRazorpayMethod } from '../controllers/webhookController';
import { retireOrReplaceLink } from './paymentLinkLifecycle';
import { UserRole } from '../types/enums';

// Same staff-ownership rule as recordPayment/reportBankUpiPayment — a
// staff caller can only act on orders assigned to them. Resolves the order
// + invoice once for both public entry points below.
const resolveOrderForLinkAction = async (orderId: string, role: UserRole, requestedById: string) => {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { invoice: true } });
  if (!order) {
    const err = new Error('Order not found.');
    (err as any).status = 404;
    throw err;
  }
  if (role === 'staff' && order.staffId !== requestedById) {
    const err = new Error('Forbidden: you can only act on orders assigned to you.');
    (err as any).status = 403;
    throw err;
  }
  if (!order.invoice) {
    const err = new Error('This order has no invoice yet.');
    (err as any).status = 409;
    throw err;
  }
  return order;
};

// Payment-safety corrections (2026-11-01) — backs the mobile Razorpay
// panel's "Payment Received" and "Resend Link" actions. Both start from the
// same ground-truth read: our own DB is trusted only as far as it goes,
// anything it can't confirm is checked live against Razorpay, never assumed.

export interface LivePaymentLinkState {
  summary: InvoicePaymentSummary;
  razorpayPaymentLinkId: string | null;
  paymentLinkUrl: string | null;
  paymentLinkStatus: string | null;
  // True only when this call itself found and reconciled a payment our own
  // webhook had missed — surfaced to the caller so "Payment Received" can
  // tell staff something changed just now, not just report old state.
  reconciledNow: boolean;
}

// Shared by verifyPaymentLink and resendPaymentLink below. Never writes
// anything beyond reconciling a genuinely missed, already-captured payment
// through the exact same path a real webhook uses (recordOnlinePayment) —
// dedup'd on razorpayPaymentId, same as the webhook.
export const getLivePaymentLinkState = async (invoiceId: string): Promise<LivePaymentLinkState> => {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { order: true } });
  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }

  let reconciledNow = false;

  if (invoice.invoicePaymentStatus !== 'paid' && invoice.razorpayPaymentLinkId) {
    const fetchResult = await fetchPaymentLink(invoice.razorpayPaymentLinkId);
    if (fetchResult.success && fetchResult.payments) {
      for (const p of fetchResult.payments) {
        if (p.status !== 'captured') continue;
        const existing = await prisma.payment.findUnique({ where: { razorpayPaymentId: p.id } });
        if (existing) continue;

        // Missed-webhook recovery — amount from Razorpay is paise, this
        // function wants rupees, same conversion the webhook itself does.
        await recordOnlinePayment(invoice.order.id, mapRazorpayMethod(p.method ?? undefined), p.amount / 100, p.id, p.method ?? 'unknown');
        reconciledNow = true;
      }
    }
    // A failed live fetch is swallowed here deliberately — the caller still
    // gets our last-known DB state rather than an error, same as if this
    // function had never attempted the live check at all.
  }

  const summary = await getInvoicePaymentSummary(prisma, invoiceId);
  const refreshed = await prisma.invoice.findUnique({ where: { id: invoiceId } });

  return {
    summary,
    razorpayPaymentLinkId: refreshed?.razorpayPaymentLinkId ?? null,
    paymentLinkUrl: refreshed?.paymentLinkUrl ?? null,
    paymentLinkStatus: refreshed?.paymentLinkStatus ?? null,
    reconciledNow,
  };
};

export interface ResendLinkResult {
  reused: boolean;
  completed: boolean;
  razorpayPaymentLinkId: string | null;
  paymentLinkUrl: string | null;
}

// Reuses the existing link when it's still genuinely valid for THIS
// invoice and THIS outstanding amount; only reissues (cancel + create,
// via the existing centralized retireOrReplaceLink) when reuse fails any
// of the three checks below. Never called for a fully-settled invoice —
// that's not a "resend", there's nothing left to collect.
export const resendPaymentLink = async (invoiceId: string, triggeredById: string): Promise<ResendLinkResult> => {
  const state = await getLivePaymentLinkState(invoiceId);
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { order: true } });
  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }

  if (state.summary.outstandingPaise <= 0n) {
    return {
      reused: false,
      completed: true,
      razorpayPaymentLinkId: state.razorpayPaymentLinkId,
      paymentLinkUrl: state.paymentLinkUrl,
    };
  }

  if (state.razorpayPaymentLinkId && state.paymentLinkUrl && state.paymentLinkStatus === 'created') {
    const fetchResult = await fetchPaymentLink(state.razorpayPaymentLinkId);
    const stillPayable = fetchResult.success && fetchResult.status !== 'paid' && fetchResult.status !== 'cancelled' && fetchResult.status !== 'expired';
    const belongsToThisOrder = fetchResult.notes?.orderId === invoice.order.id;
    const amountMatchesOutstanding = fetchResult.amount === Number(state.summary.outstandingPaise);

    if (stillPayable && belongsToThisOrder && amountMatchesOutstanding) {
      return {
        reused: true,
        completed: true,
        razorpayPaymentLinkId: state.razorpayPaymentLinkId,
        paymentLinkUrl: state.paymentLinkUrl,
      };
    }
  }

  const result = await retireOrReplaceLink(invoiceId, 'reissue', triggeredById);
  return {
    reused: false,
    completed: result.completed,
    razorpayPaymentLinkId: result.newPaymentLinkId,
    paymentLinkUrl: result.newPaymentLinkUrl,
  };
};

// Public entry points — used by the new orderController handlers. Resolve
// ownership the same way recordPayment does, then delegate to the
// invoice-scoped functions above.
export const verifyPaymentLinkForOrder = async (orderId: string, role: UserRole, requestedById: string) => {
  const order = await resolveOrderForLinkAction(orderId, role, requestedById);
  return getLivePaymentLinkState(order.invoice!.id);
};

export const resendPaymentLinkForOrder = async (orderId: string, role: UserRole, requestedById: string) => {
  const order = await resolveOrderForLinkAction(orderId, role, requestedById);
  return resendPaymentLink(order.invoice!.id, requestedById);
};
