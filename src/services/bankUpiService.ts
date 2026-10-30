import prisma from '../prisma/client';
import { UserRole } from '../types/enums';
import { recordVerifiedPayment, promotePendingPaymentToVerified, getInvoicePaymentSummary } from './paymentLedgerService';
import { retireOrReplaceLink } from './paymentLinkLifecycle';

// Payment-safety review section 7, "Static Bank UPI Workflow" — the
// business's fixed QR code pays directly into the bank account with no
// automatic visibility to this app at all, unlike Razorpay. Two stages,
// deliberately NOT the same endpoint as orderService.ts::recordPayment
// (cash/upi/net_banking/credit_card — staff directly observed those
// happening): a bank_upi report is staff *claiming* a transfer landed,
// unverified, until an authorized person checks the real bank account.

interface ReportInput {
  orderId: string;
  amount: number;
  utrReference: string;
  reportedById: string;
  role: UserRole;
  notes?: string;
}

// Stage A — "Payment Reported". Creates a `pending` Payment row with ZERO
// allocation (spec: "do not mark the invoice paid based only on a
// screenshot or manually entered UTR"). Same staff-ownership rule as
// recordPayment — a staff member can only report against their own order.
export const reportBankUpiPayment = async (input: ReportInput) => {
  if (!input.utrReference || !input.utrReference.trim()) {
    const err = new Error('utrReference is required.');
    (err as any).status = 400;
    throw err;
  }
  if (!(input.amount > 0)) {
    const err = new Error('amount must be greater than zero.');
    (err as any).status = 400;
    throw err;
  }

  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: { invoice: true },
  });

  if (!order) {
    const err = new Error('Order not found.');
    (err as any).status = 404;
    throw err;
  }

  if (input.role === 'staff' && order.staffId !== input.reportedById) {
    const err = new Error('Forbidden: you can only report payment for orders assigned to you.');
    (err as any).status = 403;
    throw err;
  }

  if (!order.invoice) {
    const err = new Error('This order has no invoice yet — cannot report a payment against it.');
    (err as any).status = 409;
    throw err;
  }

  // Spec section 3: "for manually entered UTRs, detect possible duplicates
  // without assuming that an unverified or incorrectly entered UTR proves a
  // bank deposit." Flag, never hard-block — a second real deposit under a
  // coincidentally-matching UTR is possible, if rare; this surfaces the
  // suspicion for Stage B's human verifier to actually resolve.
  const existingWithSameUtr = await prisma.payment.findFirst({
    where: { utrReference: input.utrReference.trim(), paymentSource: 'bank_upi' },
  });

  const { payment } = await prisma.$transaction(async (tx) =>
    recordVerifiedPayment(tx, {
      invoiceId: order.invoice!.id,
      orderId: input.orderId,
      customerId: order.customerId,
      grossAmount: input.amount,
      paymentType: 'order_payment',
      paymentMethod: 'upi',
      paymentSource: 'bank_upi',
      recordedById: input.reportedById,
      verificationStatus: 'pending',
      utrReference: input.utrReference.trim(),
      isDuplicateUtrSuspected: Boolean(existingWithSameUtr),
      notes: input.notes ?? null,
    })
  );

  return payment;
};

// Stage B — "Payment Verified". Admin-only (enforced at the route/controller
// layer, not re-checked here — consistent with this codebase's existing
// pattern of role gating at the route, e.g. discount endpoints). Promotes
// the pending report to verified and allocates it against the CURRENT
// outstanding balance, then runs the same centralized link-lifecycle
// retirement/replacement cash payments use.
export const verifyBankUpiPayment = async (paymentId: string, verifiedById: string) => {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) {
    const err = new Error('Payment report not found.');
    (err as any).status = 404;
    throw err;
  }
  if (payment.paymentSource !== 'bank_upi') {
    const err = new Error('This endpoint only verifies bank_upi payment reports.');
    (err as any).status = 400;
    throw err;
  }

  const { summary } = await prisma.$transaction(async (tx) => promotePendingPaymentToVerified(tx, paymentId, verifiedById));

  if (payment.invoiceId) {
    const reason = summary.outstandingPaise > 0n ? 'bank_upi_partial' : 'bank_upi_full';
    await retireOrReplaceLink(payment.invoiceId, reason, verifiedById);
  }

  return summary;
};

// Admin-only — a reported UTR that turns out to be wrong/unfindable in the
// real bank statement. No ledger impact (it was never allocated), just
// marks the row so it stops showing up as "awaiting verification".
export const rejectBankUpiPayment = async (paymentId: string, rejectedById: string, reason: string) => {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) {
    const err = new Error('Payment report not found.');
    (err as any).status = 404;
    throw err;
  }
  if (payment.verificationStatus !== 'pending') {
    const err = new Error(`Payment ${paymentId} is not pending verification.`);
    (err as any).status = 400;
    throw err;
  }

  return prisma.payment.update({
    where: { id: paymentId },
    data: {
      verificationStatus: 'rejected',
      verifiedById: rejectedById,
      verifiedAt: new Date(),
      notes: payment.notes ? `${payment.notes}\nRejected: ${reason}` : `Rejected: ${reason}`,
    },
  });
};

// Admin-only listing — "awaiting verification" queue (spec section 12/7:
// a manual UPI verification queue with UTR matching and audit history).
export const listPendingBankUpiPayments = (branchId?: string) =>
  prisma.payment.findMany({
    where: {
      paymentSource: 'bank_upi',
      verificationStatus: 'pending',
      ...(branchId ? { customer: { branchId } } : {}),
    },
    include: { customer: { select: { fullName: true, locationLabel: true, branchId: true } }, order: { select: { orderNumber: true } } },
    orderBy: { createdAt: 'asc' },
  });

export const getInvoicePaymentSummaryForOrder = async (orderId: string) => {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { invoice: true } });
  if (!order?.invoice) {
    const err = new Error('This order has no invoice yet.');
    (err as any).status = 404;
    throw err;
  }
  return getInvoicePaymentSummary(prisma, order.invoice.id);
};
