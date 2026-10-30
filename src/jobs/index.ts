import cron from 'node-cron';
import { generateMonthlyStatements } from '../services/ledgerService';
import { recoverStuckTransitions } from '../services/paymentLinkLifecycle';

export const registerJobs = (): void => {
  // 1st of every month, 09:00 server time — see ledgerService.ts's
  // generateMonthlyStatements for what it actually sends and to whom.
  // Errors are caught and logged here, not left to reject silently — a
  // scheduled cron callback has no caller to propagate a rejection to.
  cron.schedule('0 9 1 * *', () => {
    generateMonthlyStatements().catch((err) => console.error('Monthly statement job failed:', err));
  });

  // Every 10 minutes — payment-safety review section 4.3/14 (Recovery test
  // #28): a PaymentLinkTransition stuck mid-flight (process crash between
  // the Razorpay cancel call and the next DB write) needs something other
  // than a human noticing to get resumed. 15-minute staleness window (the
  // function's own default) comfortably exceeds any real Razorpay API
  // round-trip, so this never races a transition that's simply still in
  // progress normally.
  cron.schedule('*/10 * * * *', () => {
    recoverStuckTransitions().catch((err) => console.error('Payment-link transition recovery job failed:', err));
  });
};
