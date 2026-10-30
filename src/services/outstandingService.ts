import prisma from '../prisma/client';
import {
  Tx,
  getInvoicePaymentSummary,
  lockInvoiceForUpdate,
  recalculateInvoiceStatus,
} from './paymentLedgerService';
import { toPaise, fromPaise, clampNonNegative } from '../utils/money';

export interface InvoiceOutstandingRow {
  invoiceId: string;
  invoiceNumber: string;
  orderId: string;
  orderNumber: string;
  invoiceDate: Date;
  dueDate: Date | null;
  originalAmount: number;
  collected: number;
  // Admin Payment Override — sum of active (non-reversed) InvoiceAdjustment
  // waivers on this invoice. 0 for an invoice nobody has closed.
  waivedAmount: number;
  outstanding: number;
  status: 'unpaid' | 'partially_paid' | 'paid';
}

export interface CustomerOutstandingSummary {
  customerId: string;
  invoices: InvoiceOutstandingRow[];
  totalOutstanding: number;
  totalCollected: number;
  totalOriginal: number;
}

// Outstanding-dues rework, section 2: "A customer may have multiple orders
// and multiple partially paid invoices... maintain the outstanding
// balance separately for every original invoice... never derive
// outstanding amounts solely from paymentStatus." Deliberately scoped to
// non-monthly-billing orders only — a monthly-billing customer's balance
// lives entirely in the separate LedgerEntry running-balance model
// (ledgerService.ts), which this does not touch or duplicate (per the
// Phase 1 audit finding that these are genuinely two different financial
// models, not one shared one).
export const getCustomerOutstandingSummary = async (customerId: string): Promise<CustomerOutstandingSummary> => {
  const invoices = await prisma.invoice.findMany({
    where: { order: { customerId, billingMode: { not: 'monthly_billing' } } },
    include: { order: { select: { orderNumber: true } } },
  });

  const rows: InvoiceOutstandingRow[] = [];
  let totalOutstanding = 0;
  let totalCollected = 0;
  let totalOriginal = 0;

  for (const invoice of invoices) {
    const summary = await getInvoicePaymentSummary(prisma, invoice.id);
    const outstanding = fromPaise(summary.outstandingPaise);
    const collected = fromPaise(summary.allocatedPaise);
    const waivedAmount = fromPaise(summary.waivedPaise);
    const original = Number(invoice.amount ?? 0);

    rows.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      orderId: invoice.orderId,
      orderNumber: invoice.order.orderNumber,
      invoiceDate: invoice.createdAt,
      dueDate: invoice.dueDate,
      originalAmount: original,
      collected,
      waivedAmount,
      outstanding,
      status: summary.status,
    });

    totalOutstanding += outstanding;
    totalCollected += collected;
    totalOriginal += original;
  }

  // Oldest-due-first display order — same ordering the allocation function
  // below consumes in, so the UI and the actual settlement order always
  // agree with each other.
  rows.sort((a, b) => {
    const aDue = (a.dueDate ?? a.invoiceDate).getTime();
    const bDue = (b.dueDate ?? b.invoiceDate).getTime();
    return aDue !== bDue ? aDue - bDue : a.invoiceId < b.invoiceId ? -1 : a.invoiceId > b.invoiceId ? 1 : 0;
  });

  return { customerId, invoices: rows, totalOutstanding, totalCollected, totalOriginal };
};

export interface AllocateAcrossCustomerInput {
  customerId: string;
  grossAmount: number;
  paymentType: string;
  paymentMethod: string;
  paymentSource: 'razorpay' | 'cash' | 'bank_upi';
  recordedById?: string | null;
  verifiedById?: string | null;
  razorpayPaymentId?: string | null;
  utrReference?: string | null;
  idempotencyKey?: string | null;
  notes?: string | null;
  paymentRequestId?: string | null;
}

export interface AllocateAcrossCustomerResult {
  paymentId: string;
  totalAllocatedPaise: bigint;
  excessPaise: bigint;
  touchedInvoices: { invoiceId: string; allocatedPaise: bigint }[];
}

// Outstanding-dues rework, section 4: "Payment Allocation Across Multiple
// Invoices" — a single payment NOT tied to one specific order/invoice (a
// customer pays down their general outstanding balance, or fulfills a
// combined PaymentRequest spanning several invoices). Oldest-due-first by
// default (dueDate, falling back to invoice date, then invoice ID as a
// deterministic tiebreak). An explicit per-invoice designation still goes
// through paymentLedgerService.ts::recordVerifiedPayment instead — this
// function is specifically for the "no single target" case.
//
// Locks every CANDIDATE invoice in a FIXED id-sorted order (not the
// due-date CONSUMPTION order used below) before allocating anything — two
// concurrent multi-invoice payments touching an overlapping set of
// invoices then always acquire their locks in the same relative order,
// so neither can deadlock the other.
export const allocatePaymentAcrossCustomerInvoices = async (
  tx: Tx,
  input: AllocateAcrossCustomerInput
): Promise<AllocateAcrossCustomerResult> => {
  const grossPaise = toPaise(input.grossAmount);

  const candidateInvoices = await tx.invoice.findMany({
    where: {
      order: { customerId: input.customerId, billingMode: { not: 'monthly_billing' } },
      invoicePaymentStatus: { not: 'paid' },
    },
    orderBy: { id: 'asc' },
  });

  for (const invoice of candidateInvoices) {
    await lockInvoiceForUpdate(tx, invoice.id);
  }

  const payment = await tx.payment.create({
    data: {
      customerId: input.customerId,
      invoiceId: null,
      paymentRequestId: input.paymentRequestId ?? null,
      amount: fromPaise(grossPaise),
      amountPaise: grossPaise,
      allocatedPaise: 0n, // updated below once the allocation loop completes
      paymentType: input.paymentType,
      paymentMethod: input.paymentMethod,
      paymentSource: input.paymentSource,
      razorpayPaymentId: input.razorpayPaymentId ?? null,
      utrReference: input.utrReference ?? null,
      verificationStatus: 'verified',
      verifiedById: input.verifiedById ?? input.recordedById ?? null,
      verifiedAt: new Date(),
      status: 'success',
      recordedById: input.recordedById ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      notes: input.notes ?? null,
    },
  });

  // Consumption order is oldest-due-first — deliberately re-sorted from the
  // id-sorted lock-acquisition order above (locking order exists purely to
  // avoid deadlocks; it has nothing to do with WHICH invoice gets settled
  // first).
  const ordered = [...candidateInvoices].sort((a, b) => {
    const aDue = (a.dueDate ?? a.createdAt).getTime();
    const bDue = (b.dueDate ?? b.createdAt).getTime();
    return aDue !== bDue ? aDue - bDue : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  let remaining = grossPaise;
  const touchedInvoices: { invoiceId: string; allocatedPaise: bigint }[] = [];

  for (const invoice of ordered) {
    if (remaining <= 0n) break;

    const summary = await getInvoicePaymentSummary(tx, invoice.id);
    if (summary.outstandingPaise <= 0n) continue;

    const take = remaining <= summary.outstandingPaise ? remaining : summary.outstandingPaise;

    await tx.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId: invoice.id, allocatedPaise: take } });
    await recalculateInvoiceStatus(tx, invoice.id, invoice.orderId);
    touchedInvoices.push({ invoiceId: invoice.id, allocatedPaise: take });
    remaining -= take;
  }

  const totalAllocatedPaise = grossPaise - remaining;
  await tx.payment.update({ where: { id: payment.id }, data: { allocatedPaise: totalAllocatedPaise } });

  if (remaining > 0n) {
    // Nothing left to apply this against — a genuine customer-level
    // excess, not tied to any single invoice (every eligible invoice was
    // already fully covered, or there were none at all). Spec section 5:
    // "Unexpected excess collections must be recorded and flagged for
    // reconciliation" — same principle as the single-invoice overpayment
    // path, just not anchored to one invoiceId.
    await tx.paymentReconciliationException.create({
      data: {
        invoiceId: null,
        paymentRequestId: input.paymentRequestId ?? null,
        customerId: input.customerId,
        exceptionType: 'overpayment',
        collectedPaise: grossPaise,
        allocatedPaise: totalAllocatedPaise,
        excessPaise: remaining,
        relatedPaymentIds: [payment.id],
        status: 'open',
        resolutionNotes:
          touchedInvoices.length > 0
            ? `₹${fromPaise(remaining)} left over after settling every outstanding invoice for this customer.`
            : `₹${fromPaise(remaining)} collected but this customer has no outstanding invoices to apply it against.`,
      },
    });
  }

  return { paymentId: payment.id, totalAllocatedPaise, excessPaise: clampNonNegative(remaining), touchedInvoices };
};

// Convenience wrapper mirroring orderService.ts::recordPayment's shape
// (idempotency pre-check outside any transaction, then the real work
// inside one) — the one call site a new "record a general customer
// payment" admin/staff action actually calls.
export const recordCustomerPayment = async (input: AllocateAcrossCustomerInput): Promise<AllocateAcrossCustomerResult> => {
  if (input.idempotencyKey) {
    const existing = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      const allocations = await prisma.paymentAllocation.findMany({ where: { paymentId: existing.id } });
      return {
        paymentId: existing.id,
        totalAllocatedPaise: existing.allocatedPaise,
        excessPaise: clampNonNegative(existing.amountPaise - existing.allocatedPaise),
        touchedInvoices: allocations.map((a) => ({ invoiceId: a.invoiceId, allocatedPaise: a.allocatedPaise })),
      };
    }
  }

  return prisma.$transaction((tx) => allocatePaymentAcrossCustomerInvoices(tx, input));
};
