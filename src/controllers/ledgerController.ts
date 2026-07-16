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
