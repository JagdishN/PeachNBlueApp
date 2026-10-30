import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getCustomerOutstandingSummary, recordCustomerPayment } from '../services/outstandingService';

// Staff + admin — view-only (Outstanding Payments > Customer Details).
export const getCustomerOutstandingHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const summary = await getCustomerOutstandingSummary(req.params.id);
  res.status(200).json({ outstanding: summary });
};

// Outstanding-dues rework, section 4 — a general payment against this
// customer's outstanding balance, NOT tied to one specific order's screen
// (that's still PATCH /orders/:id/payment, unchanged). Scoped to `cash`
// only for now: a bank_upi payment here would need the same two-stage
// report/verify discipline as the existing per-order bank-UPI workflow
// (bankUpiService.ts), and allocating a STILL-UNVERIFIED report across
// multiple invoices at once is a separately-scoped follow-up, not built
// in this pass — flagged rather than silently half-built.
export const recordCustomerPaymentHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { amount, idempotencyKey, notes } = req.body;

  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }

  const result = await recordCustomerPayment({
    customerId: req.params.id,
    grossAmount: amount,
    paymentType: 'customer_payment',
    paymentMethod: 'cash',
    paymentSource: 'cash',
    recordedById: req.auth!.userId,
    idempotencyKey,
    notes,
  });

  res.status(200).json({
    paymentId: result.paymentId,
    totalAllocated: Number(result.totalAllocatedPaise) / 100,
    excess: Number(result.excessPaise) / 100,
    touchedInvoices: result.touchedInvoices.map((t) => ({
      invoiceId: t.invoiceId,
      allocated: Number(t.allocatedPaise) / 100,
    })),
  });
};
