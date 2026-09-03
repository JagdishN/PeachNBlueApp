import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { getAgingReportHandler, sendReminderHandler, runMonthlyStatementsHandler } from '../controllers/ledgerController';

const router = Router();

router.use(authenticate, requireRole(['admin']));

router.get('/aging', getAgingReportHandler);
router.post('/:customerId/remind', sendReminderHandler);
router.post('/statements/run', runMonthlyStatementsHandler);

export default router;
