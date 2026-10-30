import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  listCustomersHandler,
  createCustomerHandler,
  updateCustomerHandler,
  deleteCustomerHandler,
  searchCustomersHandler,
  updateDiscountHandler,
  updateDiscountEnabledHandler,
  updateBillingModeHandler,
  markBagIssuedHandler,
  reportBagReplacementHandler,
  listBagReplacementsHandler,
  listDiscountAuditHandler,
} from '../controllers/customerController';
import { getCustomerOutstandingHandler, recordCustomerPaymentHandler } from '../controllers/outstandingController';
import { sendPaymentReminderHandler, listReminderHistoryHandler } from '../controllers/reminderController';
import { getCustomerStatementHandler } from '../controllers/reportingController';

const router = Router();

router.use(authenticate);

router.get('/', requireRole(['admin']), listCustomersHandler);
router.get('/search', requireRole(['staff', 'admin']), searchCustomersHandler);
router.post('/', requireRole(['staff', 'admin']), createCustomerHandler);
router.patch('/:id', requireRole(['admin']), updateCustomerHandler);
router.delete('/:id', requireRole(['admin']), deleteCustomerHandler);
router.patch('/:id/discount', requireRole(['admin']), updateDiscountHandler);
router.patch('/:id/discount-enabled', requireRole(['admin']), updateDiscountEnabledHandler);
router.get('/:id/discount-audit', requireRole(['admin']), listDiscountAuditHandler);
router.patch('/:id/billing-mode', requireRole(['admin']), updateBillingModeHandler);
router.patch('/:id/bag-issued', requireRole(['staff', 'admin']), markBagIssuedHandler);
router.post('/:id/bag-replacement', requireRole(['staff', 'admin']), reportBagReplacementHandler);
router.get('/:id/bag-replacements', requireRole(['admin']), listBagReplacementsHandler);
// Outstanding-dues rework (section 2/4/10) — view and record-payment are
// staff + admin; the admin-only "Send Reminder" action lands on its own
// route later (section 7's explicit staff exclusion), not here.
router.get('/:id/outstanding', requireRole(['staff', 'admin']), getCustomerOutstandingHandler);
router.post('/:id/payments', requireRole(['staff', 'admin']), recordCustomerPaymentHandler);
// Admin-only, deliberately NOT staff — section 7's explicit restriction.
router.post('/:id/send-reminder', requireRole(['admin']), sendPaymentReminderHandler);
router.get('/:id/reminder-history', requireRole(['admin']), listReminderHistoryHandler);
router.get('/:id/statement', requireRole(['admin']), getCustomerStatementHandler);

export default router;
