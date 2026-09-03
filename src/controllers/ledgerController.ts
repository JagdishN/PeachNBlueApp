import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import * as ledgerService from '../services/ledgerService';

export const getAgingReportHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const branchId = req.auth!.branchId ?? undefined;
  const rows = await ledgerService.getAgingReport(branchId);
  res.status(200).json({ aging: rows });
};

export const sendReminderHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  await ledgerService.sendReminder(req.params.customerId);
  res.status(200).json({ message: 'Reminder sent' });
};

// Manual trigger — same on-demand + cron pairing sendReminder already has
// (the cron itself is registered in jobs/index.ts, 1st of every month).
// Lets admin re-run/test statement generation without waiting for the
// schedule.
export const runMonthlyStatementsHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const result = await ledgerService.generateMonthlyStatements();
  res.status(200).json(result);
};
