import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  verifyBankUpiPaymentHandler,
  rejectBankUpiPaymentHandler,
  listPendingBankUpiPaymentsHandler,
} from '../controllers/bankUpiController';
import {
  listReconciliationExceptionsHandler,
  resolveReconciliationExceptionHandler,
} from '../controllers/reconciliationController';
import { importBankStatementHandler, listUnmatchedBankTransactionsHandler } from '../controllers/bankStatementController';
import {
  closeOutstandingBalanceHandler,
  reverseAdjustmentHandler,
  listInvoiceAdjustmentsHandler,
} from '../controllers/invoiceAdjustmentController';

// All admin-only — Stage B of the Static Bank UPI Workflow (verifying a
// staff-reported transfer against the real bank account) and reconciliation
// exception review are both back-office actions, not something staff
// should be able to self-approve (payment-safety review sections 3, 7, 9).
const router = Router();

router.use(authenticate);
router.use(requireRole(['admin']));

router.get('/bank-upi/pending', listPendingBankUpiPaymentsHandler);
router.patch('/:id/verify-bank-upi', verifyBankUpiPaymentHandler);
router.patch('/:id/reject-bank-upi', rejectBankUpiPaymentHandler);

router.get('/reconciliation-exceptions', listReconciliationExceptionsHandler);
router.patch('/reconciliation-exceptions/:id/resolve', resolveReconciliationExceptionHandler);

router.post('/bank-statement/import', importBankStatementHandler);
router.get('/bank-statement/unmatched', listUnmatchedBankTransactionsHandler);

// Admin Payment Override — admin-only (this whole router already is), per
// spec section 5's "Staff must not be able to perform the operation by
// directly calling the endpoint."
router.get('/invoices/:invoiceId/adjustments', listInvoiceAdjustmentsHandler);
router.post('/invoices/:invoiceId/close-outstanding', closeOutstandingBalanceHandler);
router.post('/invoices/:invoiceId/adjustments/:adjustmentId/reverse', reverseAdjustmentHandler);

export default router;
