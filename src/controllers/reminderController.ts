import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { sendPaymentReminder, listReminderHistory } from '../services/reminderService';

// Admin-only, enforced at the route layer (routes/customers.ts) — spec
// section 7: "Send Payment Reminder must be restricted to Admin users
// only. Staff must not be allowed to send reminders," and "Enforce
// Admin-only permission at the backend API and frontend UI."
export const sendPaymentReminderHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { invoiceIds, overrideDuplicateWarning } = req.body;

  const result = await sendPaymentReminder({
    customerId: req.params.id,
    adminId: req.auth!.userId,
    invoiceIds: Array.isArray(invoiceIds) ? invoiceIds : undefined,
    overrideDuplicateWarning: Boolean(overrideDuplicateWarning),
  });

  res.status(200).json({ reminder: result });
};

export const listReminderHistoryHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const history = await listReminderHistory(req.params.id);
  // Real bug caught while writing the mobile client, not by any test: a
  // raw Prisma row's outstandingAtSendPaise is a BigInt, and Express's
  // res.json() (plain JSON.stringify under the hood) throws outright on
  // one — "Do not know how to serialize a BigInt." Every other controller
  // in this rework already converts to a plain number before responding;
  // this one was missed since no test here exercises a real JSON
  // serialization pass (mocked service calls never produce a real bigint).
  res.status(200).json({
    history: history.map((entry) => ({
      ...entry,
      outstandingAtSendPaise: undefined,
      outstandingAtSend: Number(entry.outstandingAtSendPaise) / 100,
    })),
  });
};
