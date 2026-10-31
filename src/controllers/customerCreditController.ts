import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../prisma/client';
import { serializeBigInts } from '../utils/serialize';
import {
  getCustomerCreditBalance,
  getCustomerCreditHistory,
  lockCustomerCreditForUpdate,
  refundCredit,
  reverseCreditTransaction,
} from '../services/customerCreditService';
import { toPaise } from '../utils/money';

// Payment collection / customer advances rework, Phase 7: "make balances
// visible to Admin and authorized Staff" — both roles can read; only Admin
// can refund/reverse (Phase 4: "any customer credit refund must be
// recorded as an actual refund transaction with appropriate
// authorization").
export const getCustomerCreditBalanceHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const balance = await getCustomerCreditBalance(prisma, req.params.id);
  res.status(200).json({ balance: serializeBigInts(balance) });
};

export const getCustomerCreditHistoryHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const history = await getCustomerCreditHistory(req.params.id);
  res.status(200).json({ history: serializeBigInts(history) });
};

// Admin-only. Rejects refunding more than the current available balance —
// refundCredit itself enforces this under a real row lock.
export const refundCustomerCreditHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { amount, reason } = req.body;

  if (!(typeof amount === 'number' && amount > 0)) {
    res.status(400).json({ error: 'amount must be a positive number.' });
    return;
  }
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    res.status(400).json({ error: 'A reason is required to refund customer credit.' });
    return;
  }

  const transaction = await prisma.$transaction(async (tx) => {
    await lockCustomerCreditForUpdate(tx, req.params.id);
    return refundCredit(tx, {
      customerId: req.params.id,
      amountPaise: toPaise(amount),
      reason,
      createdById: req.auth!.userId,
    });
  });

  res.status(200).json({ transaction: serializeBigInts(transaction) });
};

// Admin-only. Undoes a mistaken issued/applied/refunded row without
// deleting it — see customerCreditService.ts::reverseCreditTransaction.
export const reverseCustomerCreditHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { reason } = req.body;

  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    res.status(400).json({ error: 'A reason is required to reverse a credit transaction.' });
    return;
  }

  const transaction = await prisma.$transaction(async (tx) => {
    await lockCustomerCreditForUpdate(tx, req.params.id);
    return reverseCreditTransaction(tx, {
      transactionId: req.params.transactionId,
      reason,
      createdById: req.auth!.userId,
    });
  });

  res.status(200).json({ transaction: serializeBigInts(transaction) });
};
