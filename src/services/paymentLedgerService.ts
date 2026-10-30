import { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../prisma/client';
import { toPaise, fromPaise, addPaise, clampNonNegative } from '../utils/money';

export type Tx = Prisma.TransactionClient | PrismaClient;

export interface InvoicePaymentSummary {
  requiredPaise: bigint;
  collectedPaise: bigint; // sum of ALL verified payments' gross amountPaise
  allocatedPaise: bigint; // sum of ALL verified payments' allocatedPaise (<= requiredPaise)
  // Admin Payment Override — sum of every ACTIVE (not reversed)
  // InvoiceAdjustment on this invoice. A non-payment reduction of what's
  // owed; never counted as collected/allocated money (those stay
  // payment-only, per the spec's "preserve actual payment receipts").
  waivedPaise: bigint;
  outstandingPaise: bigint;
  unallocatedExcessPaise: bigint;
  status: 'unpaid' | 'partially_paid' | 'paid';
  byMethod: Record<string, bigint>;
}

// Row-level lock on the invoice so two concurrent payment recordings (e.g. a
// staff double-tap, or a webhook landing mid-cash-collection) can't both read
// the same "remaining balance" and both allocate against it. Spec: "ensure
// two concurrent operations cannot both allocate the same outstanding
// balance" — must run inside the SAME transaction as the allocation+Payment
// write that follows, never standalone.
export const lockInvoiceForUpdate = async (tx: Tx, invoiceId: string): Promise<void> => {
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
};

const requiredPaiseFor = (invoiceAmount: unknown): bigint => toPaise(invoiceAmount ?? 0);

// Caller MUST already hold the invoice row lock (lockInvoiceForUpdate) within
// the same transaction before calling this, if the result will be used to
// decide an allocation — otherwise this is just a point-in-time read (fine
// for display purposes, e.g. the mobile "Invoice Payment Summary" screen).
export const getInvoicePaymentSummary = async (tx: Tx, invoiceId: string): Promise<InvoicePaymentSummary> => {
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }

  const verifiedPayments = await tx.payment.findMany({
    where: { invoiceId, verificationStatus: 'verified', status: { not: 'refunded' } },
  });

  const requiredPaise = requiredPaiseFor(invoice.amount);
  let collectedPaise = 0n;
  let allocatedPaise = 0n;
  const byMethod: Record<string, bigint> = {};

  for (const p of verifiedPayments) {
    collectedPaise = addPaise(collectedPaise, p.amountPaise);
    allocatedPaise = addPaise(allocatedPaise, p.allocatedPaise);
    byMethod[p.paymentSource] = addPaise(byMethod[p.paymentSource] ?? 0n, p.amountPaise);
  }

  // Admin Payment Override — only ACTIVE (not reversed) waivers reduce
  // outstanding. A reversed waiver (reversedAt set) contributes nothing
  // here, so reversal automatically restores whatever balance it closed,
  // with no separate "undo" arithmetic needed anywhere.
  const activeAdjustments = await tx.invoiceAdjustment.findMany({
    where: { invoiceId, reversedAt: null },
    select: { amountPaise: true },
  });
  const waivedPaise = activeAdjustments.reduce((sum, a) => addPaise(sum, a.amountPaise), 0n);

  const settledPaise = allocatedPaise + waivedPaise;
  const outstandingPaise = clampNonNegative(requiredPaise - settledPaise);
  const unallocatedExcessPaise = clampNonNegative(collectedPaise - allocatedPaise);
  const status: InvoicePaymentSummary['status'] =
    settledPaise >= requiredPaise && requiredPaise > 0n ? 'paid' : settledPaise > 0n ? 'partially_paid' : 'unpaid';

  return { requiredPaise, collectedPaise, allocatedPaise, waivedPaise, outstandingPaise, unallocatedExcessPaise, status, byMethod };
};

// Keeps Invoice.invoicePaymentStatus and Order.paymentStatus in sync with
// what the ledger actually shows, rather than letting each payment-recording
// call site set its own ad-hoc status (the pre-existing bug this review
// flagged — paymentStatus was "simply a manually updated field", not derived
// from verified+allocated payments). Must run inside the same transaction
// that just wrote the allocation, with the invoice lock already held.
// Takes orderId explicitly (the caller always already has it) rather than
// re-deriving it from the invoice.update() result, so this doesn't depend
// on that call returning a full row in every test/caller.
export const recalculateInvoiceStatus = async (
  tx: Tx,
  invoiceId: string,
  orderId: string
): Promise<InvoicePaymentSummary> => {
  const summary = await getInvoicePaymentSummary(tx, invoiceId);

  await tx.invoice.update({
    where: { id: invoiceId },
    data: { invoicePaymentStatus: summary.status },
  });

  // Order.paymentStatus is kept as a backward-compat mirror for existing UI
  // reads (OrderStatusScreen.tsx's "Payment received" line, admin order
  // lists) — OrderPaymentStatus's value set is unpaid|paid|partially_paid|due,
  // 'unpaid' maps to the existing 'pending' value since that's what every
  // pre-existing reader already expects for "nothing collected yet".
  const orderPaymentStatus = summary.status === 'unpaid' ? 'pending' : summary.status;
  await tx.order.update({ where: { id: orderId }, data: { paymentStatus: orderPaymentStatus } });

  return summary;
};

export interface AllocationResult {
  allocatedPaise: bigint;
  excessPaise: bigint;
}

// Pure allocation math — how much of a newly-verified payment's gross amount
// actually counts toward the invoice vs. becomes unallocated excess. Spec
// section 9: "Do not create negative invoice balances to conceal
// overpayments" — excess is always surfaced, never silently capped away.
export const allocateAgainstOutstanding = (grossPaise: bigint, outstandingBeforePaise: bigint): AllocationResult => {
  const allocatedPaise = grossPaise <= outstandingBeforePaise ? grossPaise : outstandingBeforePaise;
  const excessPaise = clampNonNegative(grossPaise - allocatedPaise);
  return { allocatedPaise, excessPaise };
};

// Creates (or updates, for the overpayment-resolution flow) the reconciliation
// exception row for an overpayment — spec section 9's required fields.
export const recordOverpaymentException = async (
  tx: Tx,
  params: { invoiceId: string; customerId: string; excessPaise: bigint; relatedPaymentIds: string[] }
): Promise<void> => {
  const summary = await getInvoicePaymentSummary(tx, params.invoiceId);
  await tx.paymentReconciliationException.create({
    data: {
      invoiceId: params.invoiceId,
      customerId: params.customerId,
      exceptionType: 'overpayment',
      collectedPaise: summary.collectedPaise,
      allocatedPaise: summary.allocatedPaise,
      excessPaise: params.excessPaise,
      relatedPaymentIds: params.relatedPaymentIds,
      status: 'open',
    },
  });
};

export interface RecordVerifiedPaymentInput {
  invoiceId: string;
  orderId: string;
  customerId: string;
  grossAmount: unknown; // Decimal rupees, or a plain number of rupees
  paymentType: string;
  paymentMethod: string;
  paymentSource: 'razorpay' | 'cash' | 'bank_upi';
  recordedById?: string | null;
  verifiedById?: string | null;
  verificationStatus?: 'pending' | 'verified' | 'rejected';
  razorpayPaymentId?: string | null;
  razorpayOrderId?: string | null;
  utrReference?: string | null;
  isDuplicateUtrSuspected?: boolean;
  idempotencyKey?: string | null;
  notes?: string | null;
}

export interface RecordVerifiedPaymentResult {
  payment: { id: string; amountPaise: bigint; allocatedPaise: bigint };
  summary: InvoicePaymentSummary;
  excessPaise: bigint;
}

// The one write path every collection channel (cash, razorpay webhook,
// bank_upi Stage B verification) funnels through to create a Payment row
// AND keep the ledger/invoice/order status consistent in the same
// transaction — spec section 3/9: "every verified receipt must be recorded,
// including unexpected duplicate payments... do not discard a real
// Razorpay receipt merely because the invoice is already marked paid."
// Caller is responsible for running this inside a prisma.$transaction and
// for NOT calling any Razorpay network API inside that same transaction
// (paymentLinkLifecycle.ts sequences those separately, before/after this).
// A `pending` (unverified, e.g. a freshly-reported bank_upi) payment is
// recorded with allocatedPaise = 0 — it does not touch the invoice's
// outstanding balance until a later verifyBankUpiPayment call promotes it.
export const recordVerifiedPayment = async (
  tx: Tx,
  input: RecordVerifiedPaymentInput
): Promise<RecordVerifiedPaymentResult> => {
  const verificationStatus = input.verificationStatus ?? 'verified';
  const grossPaise = toPaise(input.grossAmount);

  await lockInvoiceForUpdate(tx, input.invoiceId);
  const beforeSummary = await getInvoicePaymentSummary(tx, input.invoiceId);

  const { allocatedPaise, excessPaise } =
    verificationStatus === 'verified'
      ? allocateAgainstOutstanding(grossPaise, beforeSummary.outstandingPaise)
      : { allocatedPaise: 0n, excessPaise: 0n };

  const payment = await tx.payment.create({
    data: {
      orderId: input.orderId,
      invoiceId: input.invoiceId,
      customerId: input.customerId,
      amount: fromPaise(grossPaise),
      amountPaise: grossPaise,
      allocatedPaise,
      paymentType: input.paymentType,
      paymentMethod: input.paymentMethod,
      paymentSource: input.paymentSource,
      razorpayPaymentId: input.razorpayPaymentId ?? null,
      razorpayOrderId: input.razorpayOrderId ?? null,
      utrReference: input.utrReference ?? null,
      isDuplicateUtrSuspected: input.isDuplicateUtrSuspected ?? false,
      verificationStatus,
      verifiedById: verificationStatus === 'verified' ? (input.verifiedById ?? input.recordedById ?? null) : null,
      verifiedAt: verificationStatus === 'verified' ? new Date() : null,
      status: 'success',
      recordedById: input.recordedById ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      notes: input.notes ?? null,
    },
  });

  if (verificationStatus === 'verified') {
    await recalculateInvoiceStatus(tx, input.invoiceId, input.orderId);

    if (excessPaise > 0n) {
      const allVerified = await tx.payment.findMany({
        where: { invoiceId: input.invoiceId, verificationStatus: 'verified' },
        select: { id: true },
      });
      await recordOverpaymentException(tx, {
        invoiceId: input.invoiceId,
        customerId: input.customerId,
        excessPaise,
        relatedPaymentIds: allVerified.map((p) => p.id),
      });
    }
  }

  // Outstanding-dues rework — every verified allocation gets a mirroring
  // PaymentAllocation row, even for this single-invoice case, so reports/
  // statements have ONE canonical place to read "which payment settled
  // which invoice" from (not: check Payment.invoiceId sometimes, check
  // PaymentAllocation other times depending on how the payment arrived).
  if (allocatedPaise > 0n) {
    await tx.paymentAllocation.create({
      data: { paymentId: payment.id, invoiceId: input.invoiceId, allocatedPaise },
    });
  }

  const summary = await getInvoicePaymentSummary(tx, input.invoiceId);

  return { payment: { id: payment.id, amountPaise: payment.amountPaise, allocatedPaise: payment.allocatedPaise }, summary, excessPaise };
};

export interface PromoteResult {
  summary: InvoicePaymentSummary;
  excessPaise: bigint;
}

// Static Bank UPI Workflow, Stage B ("Payment Verified") — promotes a
// `pending` Payment (created with allocatedPaise = 0 at report time, Stage
// A) to `verified` and allocates it for real against the CURRENT
// outstanding balance. Deliberately a separate function from
// recordVerifiedPayment rather than that function being reused with a
// pre-existing row — this one must re-read the outstanding balance fresh
// (other payments may have landed between report and verify), not reuse
// whatever was true at report time.
export const promotePendingPaymentToVerified = async (
  tx: Tx,
  paymentId: string,
  verifiedById: string
): Promise<PromoteResult> => {
  const payment = await tx.payment.findUnique({ where: { id: paymentId } });
  if (!payment) {
    throw new Error(`Payment ${paymentId} not found`);
  }
  if (payment.verificationStatus !== 'pending') {
    throw new Error(`Payment ${paymentId} is not pending verification (status: ${payment.verificationStatus}).`);
  }
  if (!payment.invoiceId) {
    throw new Error(`Payment ${paymentId} has no invoiceId to allocate against.`);
  }

  await lockInvoiceForUpdate(tx, payment.invoiceId);
  const beforeSummary = await getInvoicePaymentSummary(tx, payment.invoiceId);
  const { allocatedPaise, excessPaise } = allocateAgainstOutstanding(payment.amountPaise, beforeSummary.outstandingPaise);

  await tx.payment.update({
    where: { id: paymentId },
    data: {
      verificationStatus: 'verified',
      verifiedById,
      verifiedAt: new Date(),
      allocatedPaise,
    },
  });

  const summary = await recalculateInvoiceStatus(tx, payment.invoiceId, payment.orderId ?? '');

  if (excessPaise > 0n) {
    const allVerified = await tx.payment.findMany({
      where: { invoiceId: payment.invoiceId, verificationStatus: 'verified' },
      select: { id: true },
    });
    await recordOverpaymentException(tx, {
      invoiceId: payment.invoiceId,
      customerId: payment.customerId,
      excessPaise,
      relatedPaymentIds: allVerified.map((p) => p.id),
    });
  }

  if (allocatedPaise > 0n) {
    await tx.paymentAllocation.create({
      data: { paymentId, invoiceId: payment.invoiceId, allocatedPaise },
    });
  }

  return { summary, excessPaise };
};

export const paiseToDisplayAmount = fromPaise;

// Admin Payment Override spec section 4: "Distinguish Paid in Full from
// Closed with Adjustment in the internal audit trail, even if existing
// customer-facing invoice status uses a general Paid label." Deliberately
// NOT a stored column — derived from the same summary everything else
// already reads (same convention this codebase uses for internalStatus vs.
// the customer-facing status, or getDisplayName's suffix-stripping): a
// second column here could drift from the real waivedPaise total.
export type InternalSettlementLabel = 'unpaid' | 'partially_paid' | 'paid_in_full' | 'closed_with_adjustment';

export const describeSettlement = (summary: InvoicePaymentSummary): InternalSettlementLabel => {
  if (summary.status !== 'paid') return summary.status;
  return summary.waivedPaise > 0n ? 'closed_with_adjustment' : 'paid_in_full';
};

export default {
  lockInvoiceForUpdate,
  getInvoicePaymentSummary,
  recalculateInvoiceStatus,
  allocateAgainstOutstanding,
  describeSettlement,
  recordOverpaymentException,
  recordVerifiedPayment,
  promotePendingPaymentToVerified,
};
