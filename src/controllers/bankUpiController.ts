import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import * as bankUpiService from '../services/bankUpiService';
import { serializeBigInts } from '../utils/serialize';

// Stage A, staff + admin (POST /api/v1/orders/:id/bank-upi-report) — see
// CLAUDE.md-equivalent documentation in bankUpiService.ts for why this is a
// separate endpoint from PATCH /:id/payment.
export const reportBankUpiPaymentHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { amount, utrReference, notes } = req.body;

  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }
  if (!utrReference || typeof utrReference !== 'string') {
    res.status(400).json({ error: 'utrReference is required' });
    return;
  }

  const payment = await bankUpiService.reportBankUpiPayment({
    orderId: req.params.id,
    amount,
    utrReference,
    reportedById: req.auth!.userId,
    role: req.auth!.role,
    notes,
  });

  res.status(201).json({ payment: serializeBigInts(payment) });
};

// Stage B, admin-only (PATCH /api/v1/payments/:id/verify-bank-upi) — route
// itself is gated to admin in routes/payments.ts, same pattern as the
// discount endpoints.
export const verifyBankUpiPaymentHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const summary = await bankUpiService.verifyBankUpiPayment(req.params.id, req.auth!.userId);

  res.status(200).json({
    paymentSummary: {
      outstanding: Number(summary.outstandingPaise) / 100,
      collected: Number(summary.collectedPaise) / 100,
      allocated: Number(summary.allocatedPaise) / 100,
      status: summary.status,
    },
  });
};

export const rejectBankUpiPaymentHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { reason } = req.body;

  if (!reason || typeof reason !== 'string') {
    res.status(400).json({ error: 'reason is required' });
    return;
  }

  const payment = await bankUpiService.rejectBankUpiPayment(req.params.id, req.auth!.userId, reason);
  res.status(200).json({ payment: serializeBigInts(payment) });
};

// Admin-only verification queue (payment-safety review section 3/7: "a
// manual UPI verification queue with UTR matching and audit history").
export const listPendingBankUpiPaymentsHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const branchId = req.auth!.branchId ?? (req.query.branchId as string | undefined) ?? undefined;
  const payments = await bankUpiService.listPendingBankUpiPayments(branchId);
  res.status(200).json({ payments: serializeBigInts(payments) });
};

export const getInvoicePaymentSummaryHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const summary = await bankUpiService.getInvoicePaymentSummaryForOrder(req.params.id);
  res.status(200).json({
    paymentSummary: {
      required: Number(summary.requiredPaise) / 100,
      collected: Number(summary.collectedPaise) / 100,
      allocated: Number(summary.allocatedPaise) / 100,
      outstanding: Number(summary.outstandingPaise) / 100,
      unallocatedExcess: Number(summary.unallocatedExcessPaise) / 100,
      status: summary.status,
      byMethod: Object.fromEntries(Object.entries(summary.byMethod).map(([k, v]) => [k, Number(v) / 100])),
    },
  });
};
