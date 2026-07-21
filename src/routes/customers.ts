import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  listCustomersHandler,
  createCustomerHandler,
  searchCustomersHandler,
  updateDiscountHandler,
  updateDiscountEnabledHandler,
  updateBillingModeHandler,
} from '../controllers/customerController';

const router = Router();

router.use(authenticate);

router.get('/', requireRole(['admin']), listCustomersHandler);
router.get('/search', requireRole(['staff', 'admin']), searchCustomersHandler);
router.post('/', requireRole(['staff', 'admin']), createCustomerHandler);
router.patch('/:id/discount', requireRole(['admin']), updateDiscountHandler);
router.patch('/:id/discount-enabled', requireRole(['admin']), updateDiscountEnabledHandler);
router.patch('/:id/billing-mode', requireRole(['admin']), updateBillingModeHandler);

export default router;
