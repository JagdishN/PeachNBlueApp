import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  getCurrentUser,
  listUsersHandler,
  createUserHandler,
  updateUserHandler,
  deactivateUserHandler,
} from '../controllers/userController';

const router = Router();

router.get('/me', authenticate, getCurrentUser);
router.get('/', authenticate, requireRole(['admin']), listUsersHandler);
router.post('/', authenticate, requireRole(['admin']), createUserHandler);
router.patch('/:id', authenticate, requireRole(['admin']), updateUserHandler);
router.delete('/:id', authenticate, requireRole(['admin']), deactivateUserHandler);

export default router;
