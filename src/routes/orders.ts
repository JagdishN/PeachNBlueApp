import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  createOrderHandler,
  getOrderHandler,
  listOrdersHandler,
  reviseAmountHandler,
  updateStatusHandler,
  recordPaymentHandler,
  assignStaffHandler,
} from '../controllers/orderController';
import { reportBankUpiPaymentHandler, getInvoicePaymentSummaryHandler } from '../controllers/bankUpiController';

const router = Router();

router.use(authenticate);
router.use(requireRole(['staff', 'admin']));

router.post('/', createOrderHandler);
router.get('/', listOrdersHandler);
router.get('/:id', getOrderHandler);
router.patch('/:id/status', updateStatusHandler);
router.patch('/:id/payment', recordPaymentHandler);
router.patch('/:id/amount', requireRole(['admin']), reviseAmountHandler);
router.patch('/:id/assign', requireRole(['admin']), assignStaffHandler);
// Payment-safety review section 7 (Static Bank UPI Workflow, Stage A) and
// section 12 (Invoice Payment Summary) — staff + admin, same ownership
// rules as PATCH /:id/payment (enforced inside the service layer).
router.post('/:id/bank-upi-report', reportBankUpiPaymentHandler);
router.get('/:id/payment-summary', getInvoicePaymentSummaryHandler);

export default router;
