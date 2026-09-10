import cron from 'node-cron';
import { generateMonthlyStatements } from '../services/ledgerService';

export const registerJobs = (): void => {
  // 1st of every month, 09:00 server time — see ledgerService.ts's
  // generateMonthlyStatements for what it actually sends and to whom.
  // Errors are caught and logged here, not left to reject silently — a
  // scheduled cron callback has no caller to propagate a rejection to.
  cron.schedule('0 9 1 * *', () => {
    generateMonthlyStatements().catch((err) => console.error('Monthly statement job failed:', err));
  });
};
