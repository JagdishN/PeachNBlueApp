import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  createOrderHandler,
  getOrderHandler,
  listOrdersHandler,
  reviseAmountHandler,
  updateStatusHandler,
} from '../controllers/orderController';

const router = Router();

router.use(authenticate);
router.use(requireRole(['staff', 'admin']));

router.post('/', createOrderHandler);
router.get('/', listOrdersHandler);
router.get('/:id', getOrderHandler);
router.patch('/:id/status', updateStatusHandler);
router.patch('/:id/amount', requireRole(['admin']), reviseAmountHandler);

export default router;
