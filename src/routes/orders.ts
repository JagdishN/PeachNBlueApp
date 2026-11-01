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
  verifyPaymentLinkHandler,
  resendPaymentLinkHandler,
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
// Priority 1 (2026-11-01) — mobile Razorpay panel's "Payment Received"/
// "Resend Link" actions. Same auth tier as PATCH /:id/payment (ownership
// enforced inside the service layer, same as every other payment action).
router.post('/:id/payment-link/verify', verifyPaymentLinkHandler);
router.post('/:id/payment-link/resend', resendPaymentLinkHandler);

export default router;
