import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  closeOutstandingBalance,
  reverseAdjustment,
  listAdjustmentsForInvoice,
  ReasonCategory,
} from '../services/invoiceAdjustmentService';
import { serializeBigInts } from '../utils/serialize';
import { fromPaise } from '../utils/money';

// Admin-only — enforced at the route layer (routes/payments.ts already
// gates this whole router to requireRole(['admin'])), same convention as
// every other handler on that router. No second role check here, matching
// this codebase's established pattern (routes/customers.ts's discount
// endpoints don't re-check role in the controller either).
export const closeOutstandingBalanceHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { reasonCategory, reason, idempotencyKey } = req.body;

  if (typeof reasonCategory !== 'string' || typeof reason !== 'string') {
    res.status(400).json({ error: 'reasonCategory and reason are required.' });
    return;
  }

  const result = await closeOutstandingBalance({
    invoiceId: req.params.invoiceId,
    adminId: req.auth!.userId,
    reasonCategory: reasonCategory as ReasonCategory,
    reason,
    idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : null,
  });

  res.status(200).json(serializeBigInts(result));
};

export const reverseAdjustmentHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { reversalReason } = req.body;

  if (typeof reversalReason !== 'string') {
    res.status(400).json({ error: 'reversalReason is required.' });
    return;
  }

  const result = await reverseAdjustment({
    invoiceId: req.params.invoiceId,
    adjustmentId: req.params.adjustmentId,
    adminId: req.auth!.userId,
    reversalReason,
  });

  res.status(200).json(serializeBigInts(result));
};

// amountPaise is converted to a plain rupee `amount` here, same convention
// as every other amount this app's API returns — leaving it as a raw paise
// integer (what serializeBigInts alone would do, since it just converts
// BigInt -> Number without a unit change) would be a wire-format
// inconsistency with closeOutstandingBalanceHandler's own waivedAmount
// right above, which is already rupees.
export const listInvoiceAdjustmentsHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const rows = await listAdjustmentsForInvoice(req.params.invoiceId);
  const adjustments = rows.map(({ amountPaise, ...rest }) => ({ ...rest, amount: fromPaise(amountPaise) }));
  res.status(200).json(serializeBigInts({ adjustments }));
};
