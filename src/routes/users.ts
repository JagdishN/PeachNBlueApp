import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { getCurrentUser, listUsersHandler, createUserHandler } from '../controllers/userController';

const router = Router();

router.get('/me', authenticate, getCurrentUser);
router.get('/', authenticate, requireRole(['admin']), listUsersHandler);
router.post('/', authenticate, requireRole(['admin']), createUserHandler);

export default router;
