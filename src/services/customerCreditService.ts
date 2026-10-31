import prisma from '../prisma/client';
import type { Tx } from './paymentLedgerService';
import { clampNonNegative } from '../utils/money';

// Payment collection / customer advances rework, Phase 4 — a customer's
// available credit is always DERIVED from the append-only transaction log
// (see schema.prisma's CustomerCredit model comment), never read from a
// stored balance column. Same "derive, don't duplicate" principle this
// codebase already applies elsewhere (internalStatus vs. the customer-
// facing status, getDisplayName's suffix stripping).

const makeError = (message: string, status: number): Error => {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
};

// Row-level lock on the customer so two concurrent operations against the
// same credit balance (an admin converting a pending-review exception
// while a different invoice's generation tries to auto-apply credit, say)
// can't both read the same "available balance" and both spend it — same
// idiom as paymentLedgerService.ts::lockInvoiceForUpdate, MUST run inside
// the same transaction as whatever write follows.
export const lockCustomerCreditForUpdate = async (tx: Tx, customerId: string): Promise<void> => {
  await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId}::uuid FOR UPDATE`;
};

export interface CustomerCreditBalance {
  availablePaise: bigint;
  issuedTotalPaise: bigint;
  appliedTotalPaise: bigint;
  refundedTotalPaise: bigint;
}

// Caller MUST already hold lockCustomerCreditForUpdate within the same
// transaction before using this result to decide a spend (apply/refund) —
// otherwise this is just a point-in-time read, fine for display purposes
// (e.g. the mobile advance-balance screen).
export const getCustomerCreditBalance = async (tx: Tx, customerId: string): Promise<CustomerCreditBalance> => {
  const rows = await tx.customerCredit.findMany({
    where: { customerId },
    include: { reversalOf: { select: { transactionType: true } } },
  });

  let available = 0n;
  let issuedTotal = 0n;
  let appliedTotal = 0n;
  let refundedTotal = 0n;

  for (const row of rows) {
    if (row.transactionType === 'issued') {
      available += row.amountPaise;
      issuedTotal += row.amountPaise;
    } else if (row.transactionType === 'applied') {
      available -= row.amountPaise;
      appliedTotal += row.amountPaise;
    } else if (row.transactionType === 'refunded') {
      available -= row.amountPaise;
      refundedTotal += row.amountPaise;
    } else if (row.transactionType === 'reversed') {
      // Sign is the OPPOSITE of whatever the reversed row represented —
      // undoing an `issued` row removes the credit it added; undoing an
      // `applied` row gives it back; undoing a `refunded` row restores it.
      const originalType = row.reversalOf?.transactionType;
      if (originalType === 'issued') available -= row.amountPaise;
      else if (originalType === 'applied' || originalType === 'refunded') available += row.amountPaise;
    }
  }

  // Phase 4: "prevent negative available balances" — a defensive floor,
  // same reasoning as paymentLedgerService.ts's outstandingPaise clamp.
  // Correct bookkeeping never produces a negative sum here in the first
  // place (every applied/refunded amount is checked against the balance
  // at write time, below), but this never silently reports a negative
  // number to a caller either way.
  return { availablePaise: clampNonNegative(available), issuedTotalPaise: issuedTotal, appliedTotalPaise: appliedTotal, refundedTotalPaise: refundedTotal };
};

export interface IssueCreditInput {
  customerId: string;
  amountPaise: bigint;
  sourcePaymentId?: string | null;
  resolvedExceptionId?: string | null;
  reason?: string | null;
  createdById: string;
}

// Writes a new `issued` row — from a staff-chosen excess-cash advance
// (Phase 3 Option B) or an admin converting a pending-review exception.
// MUST run inside the same transaction as whatever payment/exception
// triggered it, so the two are durably atomic together.
export const issueCredit = async (tx: Tx, input: IssueCreditInput) => {
  if (input.amountPaise <= 0n) {
    throw makeError('Credit amount must be greater than zero.', 400);
  }
  return tx.customerCredit.create({
    data: {
      customerId: input.customerId,
      transactionType: 'issued',
      amountPaise: input.amountPaise,
      sourcePaymentId: input.sourcePaymentId ?? null,
      resolvedExceptionId: input.resolvedExceptionId ?? null,
      reason: input.reason ?? null,
      createdById: input.createdById,
    },
  });
};

export interface ApplyCreditInput {
  customerId: string;
  invoiceId: string;
  // The invoice's own charges (or remaining outstanding) — the cap on how
  // much credit this invoice can actually absorb. Never apply more credit
  // than an invoice needs, even if more is available.
  maxApplicationPaise: bigint;
  // Null for the auto-consumption-at-generation path (invoiceService.ts,
  // no human actor) — same "null means the system" convention as
  // Payment.recordedById.
  createdById: string | null;
  reason?: string | null;
}

// Phase 4's auto-consumption-at-generation path (invoiceService.ts) and any
// future manual "apply available credit" action both go through this.
// Caller MUST hold lockCustomerCreditForUpdate first. Returns the amount
// actually applied (0 if no credit is available, or less than requested
// if the balance is smaller) — never throws for "nothing to apply," since
// that's the normal case for most invoices.
export const applyCreditToInvoice = async (tx: Tx, input: ApplyCreditInput): Promise<bigint> => {
  if (input.maxApplicationPaise <= 0n) {
    return 0n;
  }
  const balance = await getCustomerCreditBalance(tx, input.customerId);
  const toApply = balance.availablePaise < input.maxApplicationPaise ? balance.availablePaise : input.maxApplicationPaise;
  if (toApply <= 0n) {
    return 0n;
  }
  await tx.customerCredit.create({
    data: {
      customerId: input.customerId,
      transactionType: 'applied',
      amountPaise: toApply,
      appliedToInvoiceId: input.invoiceId,
      createdById: input.createdById,
      reason: input.reason ?? null,
    },
  });
  return toApply;
};

export interface RefundCreditInput {
  customerId: string;
  amountPaise: bigint;
  reason: string;
  createdById: string;
}

// Phase 4: "any customer credit refund must be recorded as an actual
// refund transaction with appropriate authorization and audit history."
// Caller MUST hold lockCustomerCreditForUpdate first. Rejects refunding
// more than the customer's current available balance — never produces a
// negative balance.
export const refundCredit = async (tx: Tx, input: RefundCreditInput) => {
  if (!input.reason || !input.reason.trim()) {
    throw makeError('A reason is required to refund customer credit.', 400);
  }
  const balance = await getCustomerCreditBalance(tx, input.customerId);
  if (input.amountPaise > balance.availablePaise) {
    throw makeError('Refund amount exceeds the customer\'s available credit balance.', 400);
  }
  return tx.customerCredit.create({
    data: {
      customerId: input.customerId,
      transactionType: 'refunded',
      amountPaise: input.amountPaise,
      reason: input.reason,
      createdById: input.createdById,
    },
  });
};

export interface ReverseCreditInput {
  transactionId: string;
  reason: string;
  createdById: string;
}

// Undoes a mistaken issued/applied/refunded row WITHOUT deleting or
// mutating it — same non-destructive pattern as InvoiceAdjustment's own
// reversal. Caller MUST hold lockCustomerCreditForUpdate first.
export const reverseCreditTransaction = async (tx: Tx, input: ReverseCreditInput) => {
  if (!input.reason || !input.reason.trim()) {
    throw makeError('A reason is required to reverse a credit transaction.', 400);
  }
  const original = await tx.customerCredit.findUnique({ where: { id: input.transactionId } });
  if (!original) {
    throw makeError('Credit transaction not found.', 404);
  }
  if (original.transactionType === 'reversed') {
    throw makeError('Cannot reverse a reversal.', 400);
  }
  const existingReversal = await tx.customerCredit.findFirst({ where: { reversalOfId: original.id } });
  if (existingReversal) {
    throw makeError('This credit transaction has already been reversed.', 409);
  }
  return tx.customerCredit.create({
    data: {
      customerId: original.customerId,
      transactionType: 'reversed',
      amountPaise: original.amountPaise,
      reversalOfId: original.id,
      reason: input.reason,
      createdById: input.createdById,
    },
  });
};

// Admin/authorized-staff visibility (Phase 7: "customer advance balances,
// advance transaction history") — point-in-time, not lock-protected (read
// only, same convention as every other list/summary endpoint).
export const getCustomerCreditHistory = (customerId: string) =>
  prisma.customerCredit.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, fullName: true } },
      appliedToInvoice: { select: { invoiceNumber: true } },
      reversalOf: { select: { id: true, transactionType: true, amountPaise: true } },
    },
  });
