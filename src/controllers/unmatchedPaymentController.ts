import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { serializeBigInts } from '../utils/serialize';
import { listUnmatchedPayments, resolveUnmatchedPayment } from '../services/unmatchedPaymentService';

// Admin-only — webhook historical-link resolution fix: a verified Razorpay
// receipt that couldn't be tied to any invoice must stay visible to a human,
// not just a server log. Mirrors reconciliationController.ts's existing
// shape exactly, same reasoning (every exception type in this app is
// listable + resolvable, not just logged).
export const listUnmatchedPaymentsHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const status = (req.query.status as string | undefined) ?? 'unresolved';
  const payments = await listUnmatchedPayments(status);
  res.status(200).json({ payments: serializeBigInts(payments) });
};

export const resolveUnmatchedPaymentHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { resolution, notes } = req.body;
  const validResolutions = ['resolved', 'ignored'];

  if (!validResolutions.includes(resolution)) {
    res.status(400).json({ error: `resolution must be one of: ${validResolutions.join(', ')}` });
    return;
  }

  const updated = await resolveUnmatchedPayment(req.params.id, resolution, notes, req.auth!.userId);
  if (!updated) {
    res.status(404).json({ error: 'Unmatched payment not found' });
    return;
  }

  res.status(200).json({ payment: serializeBigInts(updated) });
};
