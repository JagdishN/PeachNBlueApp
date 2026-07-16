import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  createGarmentHandler,
  deleteGarmentHandler,
  listGarmentsHandler,
  updateGarmentHandler,
} from '../controllers/garmentController';

const router = Router();

router.get('/', authenticate, requireRole(['staff', 'admin']), listGarmentsHandler);
router.post('/', authenticate, requireRole(['admin']), createGarmentHandler);
router.patch('/:id', authenticate, requireRole(['admin']), updateGarmentHandler);
router.delete('/:id', authenticate, requireRole(['admin']), deleteGarmentHandler);

export default router;
