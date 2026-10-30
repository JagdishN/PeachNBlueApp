import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../prisma/client';
import { serializeBigInts } from '../utils/serialize';

// Admin-only — payment-safety review section 9: every overpayment/
// cancellation-uncertain/monthly-billing-anomaly exception must be visible
// and resolvable, not just logged to a server console no one reads.
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

  res.status(200).json({ exceptions: serializeBigInts(exceptions) });
};

// Admin-only — resolves an overpayment/anomaly exception with an audited
// note (spec: "support resolution through an audited refund or customer
// credit process... do not automatically issue refunds without an approved
// business policy"). This endpoint only RECORDS the resolution decision
// (refunded / credited / other + a free-text note identifying what was
// actually done) — it never calls Razorpay's refund API itself, since that
// requires a real business decision this app shouldn't make unilaterally.
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

  const exception = await prisma.paymentReconciliationException.update({
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
