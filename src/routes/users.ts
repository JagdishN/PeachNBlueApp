import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { getCurrentUser } from '../controllers/userController';

const router = Router();

router.get('/me', authenticate, getCurrentUser);
router.get('/', authenticate, requireRole(['admin']), getCurrentUser);

export default router;
