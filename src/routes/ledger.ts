import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { getAgingReportHandler, sendReminderHandler } from '../controllers/ledgerController';

const router = Router();

router.use(authenticate, requireRole(['admin']));

router.get('/aging', getAgingReportHandler);
router.post('/:customerId/remind', sendReminderHandler);

export default router;
