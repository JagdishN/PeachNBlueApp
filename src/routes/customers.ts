import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { updateDiscountHandler } from '../controllers/customerController';

const router = Router();

router.use(authenticate);

router.patch('/:id/discount', requireRole(['admin']), updateDiscountHandler);

export default router;
