import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../prisma/client';
import { serializeBigInts } from '../utils/serialize';
import { issueCredit, lockCustomerCreditForUpdate } from '../services/customerCreditService';

// Admin-only — payment-safety review section 9: every overpayment/
// cancellation-uncertain/monthly-billing-anomaly exception must be visible
// and resolvable, not just logged to a server console no one reads.
//
// Read-only enhancement (2026-10-31, reconciliation-screen audit) —
// relatedPaymentIds is a plain String[] of our own internal Payment.id
// values, not a Prisma relation, so it can't be `include`d directly; it
// never carried the actual Razorpay Payment ID an admin would need to
// cross-check against the Razorpay dashboard. This resolves those ids to
// the real Payment rows in one extra query and attaches them as
// `relatedPayments` — purely additive to this list response, no change to
// how exceptions are created or to any ledger/allocation logic.
export const listReconciliationExceptionsHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const status = (req.query.status as string | undefined) ?? 'open';

  const exceptions = await prisma.paymentReconciliationException.findMany({
    where: status === 'all' ? {} : { status },
    include: {
      customer: { select: { fullName: true, phoneNumber: true, locationLabel: true } },
      invoice: { select: { invoiceNumber: true, orderId: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const allPaymentIds = Array.from(new Set(exceptions.flatMap((exc) => exc.relatedPaymentIds)));
  const relatedPayments = allPaymentIds.length
    ? await prisma.payment.findMany({
        where: { id: { in: allPaymentIds } },
        select: {
          id: true,
          razorpayPaymentId: true,
          amountPaise: true,
          paymentMethod: true,
          paymentSource: true,
          createdAt: true,
        },
      })
    : [];
  const paymentsById = new Map(relatedPayments.map((p) => [p.id, p]));

  const enriched = exceptions.map((exc) => ({
    ...exc,
    relatedPayments: exc.relatedPaymentIds.map((id) => paymentsById.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p)),
  }));

  res.status(200).json({ exceptions: serializeBigInts(enriched) });
};

// Admin-only — resolves an overpayment/anomaly exception with an audited
// note (spec: "support resolution through an audited refund or customer
// credit process... do not automatically issue refunds without an approved
// business policy"). For most exception types this only RECORDS the
// resolution decision (refunded / credited / other + a free-text note) —
// it never calls Razorpay's refund API itself, since that requires a real
// business decision this app shouldn't make unilaterally.
//
// Payment collection / customer advances rework (2026-10-31), Phase 3
// Option C — this is now a genuine exception to that "declarative only"
// rule, confirmed deliberately: resolving an 'unapplied_cash_pending_review'
// exception as `resolved_credited` DOES move money — it converts the held
// excess cash into a real CustomerCredit for the customer, same end state
// as if staff had chosen Option B at the counter instead of Option C. This
// is the only exceptionType/resolution combination that does so; every
// other combination (including 'resolved_credited' for any OTHER
// exceptionType) stays exactly as declarative as before.
export const resolveReconciliationExceptionHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { resolution, notes } = req.body;
  const validResolutions = ['resolved_refunded', 'resolved_credited', 'resolved_other'];

  if (!validResolutions.includes(resolution)) {
    res.status(400).json({ error: `resolution must be one of: ${validResolutions.join(', ')}` });
    return;
  }

  const existing = await prisma.paymentReconciliationException.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: 'Reconciliation exception not found' });
    return;
  }

  const isCashPendingReviewCredit = existing.exceptionType === 'unapplied_cash_pending_review' && resolution === 'resolved_credited';

  // Guards against a double-tap / retried request creating a SECOND
  // CustomerCredit for the same excess — this specific combination is the
  // only one in this handler that actually spends money, so it's the only
  // one that needs this check (every other resolution/exceptionType stays
  // a harmless, idempotent-in-effect overwrite of the same declarative
  // fields, same as before this rework).
  if (isCashPendingReviewCredit && existing.status !== 'open') {
    const err = new Error('This exception has already been resolved — cannot issue a second advance for the same excess.');
    (err as any).status = 409;
    throw err;
  }

  const exception = isCashPendingReviewCredit
    ? await prisma.$transaction(async (tx) => {
        await lockCustomerCreditForUpdate(tx, existing.customerId);
        await issueCredit(tx, {
          customerId: existing.customerId,
          amountPaise: existing.excessPaise,
          resolvedExceptionId: existing.id,
          reason: notes ?? 'Converted from an unapplied-cash pending-review exception by Admin.',
          createdById: req.auth!.userId,
        });
        return tx.paymentReconciliationException.update({
          where: { id: req.params.id },
          data: {
            status: resolution,
            resolutionNotes: notes ?? existing.resolutionNotes,
            resolvedById: req.auth!.userId,
            resolvedAt: new Date(),
          },
        });
      })
    : await prisma.paymentReconciliationException.update({
        where: { id: req.params.id },
        data: {
          status: resolution,
          resolutionNotes: notes ?? existing.resolutionNotes,
          resolvedById: req.auth!.userId,
          resolvedAt: new Date(),
        },
      });

  res.status(200).json({ exception: serializeBigInts(exception) });
};
