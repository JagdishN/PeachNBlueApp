import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  listCustomersHandler,
  createCustomerHandler,
  searchCustomersHandler,
  updateDiscountHandler,
  updateDiscountEnabledHandler,
  updateBillingModeHandler,
  markBagIssuedHandler,
  reportBagReplacementHandler,
  listBagReplacementsHandler,
  listDiscountAuditHandler,
} from '../controllers/customerController';

const router = Router();

router.use(authenticate);

router.get('/', requireRole(['admin']), listCustomersHandler);
router.get('/search', requireRole(['staff', 'admin']), searchCustomersHandler);
router.post('/', requireRole(['staff', 'admin']), createCustomerHandler);
router.patch('/:id/discount', requireRole(['admin']), updateDiscountHandler);
router.patch('/:id/discount-enabled', requireRole(['admin']), updateDiscountEnabledHandler);
router.get('/:id/discount-audit', requireRole(['admin']), listDiscountAuditHandler);
router.patch('/:id/billing-mode', requireRole(['admin']), updateBillingModeHandler);
router.patch('/:id/bag-issued', requireRole(['staff', 'admin']), markBagIssuedHandler);
router.post('/:id/bag-replacement', requireRole(['staff', 'admin']), reportBagReplacementHandler);
router.get('/:id/bag-replacements', requireRole(['admin']), listBagReplacementsHandler);

export default router;
