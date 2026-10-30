import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { importBankStatementCsv, listUnmatchedBankTransactions } from '../services/bankStatementImportService';
import { serializeBigInts } from '../utils/serialize';

export const importBankStatementHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { bankAccountRef, csvText } = req.body;

  if (!bankAccountRef || typeof bankAccountRef !== 'string') {
    res.status(400).json({ error: 'bankAccountRef is required' });
    return;
  }
  if (!csvText || typeof csvText !== 'string') {
    res.status(400).json({ error: 'csvText is required' });
    return;
  }

  try {
    const summary = await importBankStatementCsv(csvText, bankAccountRef, req.auth!.userId);
    res.status(200).json({ summary });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid bank statement CSV' });
  }
};

export const listUnmatchedBankTransactionsHandler = async (_req: AuthRequest, res: Response): Promise<void> => {
  const transactions = await listUnmatchedBankTransactions();
  res.status(200).json({ transactions: serializeBigInts(transactions) });
};
