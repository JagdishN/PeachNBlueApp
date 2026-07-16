import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { getSummaryHandler } from '../controllers/reportController';

const router = Router();

router.get('/summary', authenticate, requireRole(['admin']), getSummaryHandler);

export default router;
