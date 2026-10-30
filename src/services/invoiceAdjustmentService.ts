import prisma from '../prisma/client';
import { Tx, getInvoicePaymentSummary, lockInvoiceForUpdate, recalculateInvoiceStatus } from './paymentLedgerService';
import { retireOrReplaceLink } from './paymentLinkLifecycle';
import { fromPaise } from '../utils/money';

// Admin Payment Override, Feature 1 — close a partially paid customer
// invoice's remaining balance with a mandatory-reason waiver, without
// recording it as money received. See CLAUDE.md-equivalent reasoning in
// schema.prisma's InvoiceAdjustment model comment for why this is its own
// model rather than a fake Payment row, and paymentLedgerService.ts's
// getInvoicePaymentSummary for the single place waivedPaise is subtracted
// from outstanding (every reminder/aging/statement/previous-dues consumer
// reads through that one function, so none of them need their own
// exclusion logic).

export type ReasonCategory = 'goodwill' | 'discount_adjustment' | 'billing_correction' | 'other';

const REASON_CATEGORIES: ReasonCategory[] = ['goodwill', 'discount_adjustment', 'billing_correction', 'other'];

const makeError = (message: string, status: number, extra?: Record<string, unknown>): Error => {
  const err = new Error(message) as Error & Record<string, unknown>;
  err.status = status;
  if (extra) Object.assign(err, extra);
  return err;
};

export interface CloseOutstandingBalanceInput {
  invoiceId: string;
  adminId: string;
  reasonCategory: ReasonCategory;
  reason: string;
  idempotencyKey?: string | null;
}

export interface CloseOutstandingBalanceResult {
  adjustmentId: string;
  waivedAmount: number;
  outstandingBefore: number;
  outstandingAfter: number;
  linkLifecycle: 'not_applicable' | 'completed' | 'needs_review';
}

// Spec section 2: "Do not include 'Payment received externally' as a
// waiver reason. Actual external payments must be recorded and verified
// through the appropriate payment workflow." A free-text reason could
// still describe exactly that — this is a best-effort, case-insensitive
// guard against the one explicitly disallowed framing, not a general
// content filter.
const EXTERNAL_PAYMENT_PATTERN = /paid\s*(externally|outside|elsewhere)|external(ly)?\s*paid|received\s*(externally|outside)/i;

const validateReason = (reasonCategory: string, reason: string): void => {
  if (!REASON_CATEGORIES.includes(reasonCategory as ReasonCategory)) {
    throw makeError(`reasonCategory must be one of: ${REASON_CATEGORIES.join(', ')}`, 400);
  }
  if (!reason || !reason.trim()) {
    throw makeError('A reason is required to close an outstanding balance.', 400);
  }
  if (EXTERNAL_PAYMENT_PATTERN.test(reason)) {
    throw makeError(
      '"Payment received externally" is not a valid waiver reason — record and verify the actual payment through the normal payment workflow instead of waiving it.',
      400
    );
  }
};

export const closeOutstandingBalance = async (
  input: CloseOutstandingBalanceInput
): Promise<CloseOutstandingBalanceResult> => {
  validateReason(input.reasonCategory, input.reason);

  // Idempotency pre-check outside any transaction — same idiom as
  // outstandingService.ts::recordCustomerPayment: a repeated confirmation
  // tap with the same key returns the already-committed result rather than
  // creating a second waiver.
  if (input.idempotencyKey) {
    const existing = await prisma.invoiceAdjustment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      const summary = await getInvoicePaymentSummary(prisma, existing.invoiceId);
      return {
        adjustmentId: existing.id,
        waivedAmount: fromPaise(existing.amountPaise),
        outstandingBefore: fromPaise(existing.amountPaise),
        outstandingAfter: fromPaise(summary.outstandingPaise),
        linkLifecycle: 'not_applicable',
      };
    }
  }

  const { adjustmentId, waivedPaise, outstandingBeforePaise, hadActiveLink } = await prisma.$transaction(async (tx: Tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId }, include: { order: true } });
    if (!invoice) {
      throw makeError('Invoice not found.', 404);
    }
    if (invoice.order.billingMode === 'monthly_billing') {
      throw makeError(
        'This invoice belongs to a monthly-billing customer — that balance is settled via the ledger, not a per-invoice waiver.',
        400
      );
    }

    await lockInvoiceForUpdate(tx, input.invoiceId);

    // Spec step 6: "Check unresolved Razorpay payments and bank UPI
    // verification reports. Reject or defer closure if conflicting
    // collections are being reconciled." A pending bank_upi report means
    // the real outstanding figure might be about to drop once verified —
    // closing now risks waiving money that's already on its way in.
    const pendingVerification = await tx.payment.findFirst({
      where: { invoiceId: input.invoiceId, verificationStatus: 'pending' },
    });
    if (pendingVerification) {
      throw makeError(
        'A payment on this invoice is still awaiting verification — resolve it before closing the balance.',
        409,
        { code: 'PENDING_VERIFICATION' }
      );
    }

    const inFlightTransition = await tx.paymentLinkTransition.findFirst({
      where: { invoiceId: input.invoiceId, status: { in: ['pending', 'cancelling_old_link', 'creating_new_link'] } },
    });
    if (inFlightTransition) {
      throw makeError(
        'A payment-link transition is already in progress for this invoice — wait for it to finish before closing the balance.',
        409,
        { code: 'LINK_TRANSITION_IN_PROGRESS' }
      );
    }

    const summary = await getInvoicePaymentSummary(tx, input.invoiceId);
    if (summary.outstandingPaise <= 0n) {
      throw makeError('This invoice has no outstanding balance to close.', 400);
    }

    const adjustment = await tx.invoiceAdjustment.create({
      data: {
        invoiceId: input.invoiceId,
        adjustmentType: 'waiver',
        amountPaise: summary.outstandingPaise,
        reasonCategory: input.reasonCategory,
        reason: input.reason,
        createdById: input.adminId,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });

    await recalculateInvoiceStatus(tx, input.invoiceId, invoice.orderId);

    return {
      adjustmentId: adjustment.id,
      waivedPaise: summary.outstandingPaise,
      outstandingBeforePaise: summary.outstandingPaise,
      hadActiveLink: Boolean(invoice.razorpayPaymentLinkId),
    };
  });

  // Payment-safety review convention, reused here: the Razorpay network
  // call runs AFTER the transaction above has already committed — the
  // waiver itself (the part that matters financially) is durable even if
  // the link-cancellation step below is slow, fails, or is left uncertain.
  let linkLifecycle: CloseOutstandingBalanceResult['linkLifecycle'] = 'not_applicable';
  if (hadActiveLink) {
    const result = await retireOrReplaceLink(input.invoiceId, 'admin_waiver', input.adminId);
    linkLifecycle = result.completed ? 'completed' : 'needs_review';

    // Best-effort backfill of "related payment/link transition reference"
    // (spec section 4) — informational only; never blocks or rolls back
    // the already-committed waiver if this lookup fails for any reason.
    try {
      const transition = await prisma.paymentLinkTransition.findFirst({
        where: { invoiceId: input.invoiceId, reason: 'admin_waiver' },
        orderBy: { createdAt: 'desc' },
      });
      if (transition) {
        await prisma.invoiceAdjustment.update({ where: { id: adjustmentId }, data: { linkTransitionId: transition.id } });
      }
    } catch (err) {
      console.error('[invoiceAdjustmentService] failed to backfill linkTransitionId (non-fatal):', err);
    }
  }

  const finalSummary = await getInvoicePaymentSummary(prisma, input.invoiceId);

  return {
    adjustmentId,
    waivedAmount: fromPaise(waivedPaise),
    outstandingBefore: fromPaise(outstandingBeforePaise),
    outstandingAfter: fromPaise(finalSummary.outstandingPaise),
    linkLifecycle,
  };
};

export interface ReverseAdjustmentInput {
  invoiceId: string;
  adjustmentId: string;
  adminId: string;
  reversalReason: string;
}

export interface ReverseAdjustmentResult {
  adjustmentId: string;
  outstandingBefore: number;
  outstandingAfter: number;
  linkLifecycle: 'not_applicable' | 'completed' | 'needs_review';
}

// Spec section 6: "If an Admin closes the wrong invoice, support an
// authorized reversal with a mandatory reason. Reversal must restore the
// appropriate outstanding balance without deleting the original
// adjustment." Mutates reversedAt/reversedBy/reversalReason on the SAME
// row rather than deleting it — see schema.prisma's InvoiceAdjustment
// comment.
export const reverseAdjustment = async (input: ReverseAdjustmentInput): Promise<ReverseAdjustmentResult> => {
  if (!input.reversalReason || !input.reversalReason.trim()) {
    throw makeError('A reason is required to reverse an adjustment.', 400);
  }

  const { outstandingBeforePaise } = await prisma.$transaction(async (tx: Tx) => {
    const adjustment = await tx.invoiceAdjustment.findUnique({ where: { id: input.adjustmentId } });
    if (!adjustment || adjustment.invoiceId !== input.invoiceId) {
      throw makeError('Adjustment not found for this invoice.', 404);
    }
    if (adjustment.reversedAt) {
      throw makeError('This adjustment has already been reversed.', 409);
    }

    const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId } });
    if (!invoice) {
      throw makeError('Invoice not found.', 404);
    }

    await lockInvoiceForUpdate(tx, input.invoiceId);
    const beforeSummary = await getInvoicePaymentSummary(tx, input.invoiceId);

    await tx.invoiceAdjustment.update({
      where: { id: input.adjustmentId },
      data: { reversedAt: new Date(), reversedById: input.adminId, reversalReason: input.reversalReason },
    });

    await recalculateInvoiceStatus(tx, input.invoiceId, invoice.orderId);

    return { outstandingBeforePaise: beforeSummary.outstandingPaise };
  });

  // Outstanding is now back above zero — per spec section 6, any new
  // collection link must go through the centralized lifecycle rather than
  // resurrecting the (already-cancelled) old link id.
  const result = await retireOrReplaceLink(input.invoiceId, 'adjustment_reversal', input.adminId);
  const finalSummary = await getInvoicePaymentSummary(prisma, input.invoiceId);

  return {
    adjustmentId: input.adjustmentId,
    outstandingBefore: fromPaise(outstandingBeforePaise),
    outstandingAfter: fromPaise(finalSummary.outstandingPaise),
    linkLifecycle: result.completed ? 'completed' : 'needs_review',
  };
};

// Audit view for the mobile confirmation dialog and any admin history
// screen — every adjustment (active or reversed) for an invoice, newest
// first. Never filters out a reversed row (spec: never hide/delete).
export const listAdjustmentsForInvoice = (invoiceId: string) =>
  prisma.invoiceAdjustment.findMany({
    where: { invoiceId },
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, fullName: true } },
      reversedBy: { select: { id: true, fullName: true } },
    },
  });
