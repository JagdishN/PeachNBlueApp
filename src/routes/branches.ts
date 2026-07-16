import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  createBranchHandler,
  getBranchHandler,
  listBranchesHandler,
  updateBranchHandler,
} from '../controllers/branchController';

const router = Router();

router.get('/', authenticate, requireRole(['admin']), listBranchesHandler);
router.post('/', authenticate, requireRole(['admin']), createBranchHandler);
router.get('/:id', authenticate, requireRole(['staff', 'admin']), getBranchHandler);
router.patch('/:id', authenticate, requireRole(['admin']), updateBranchHandler);

export default router;
