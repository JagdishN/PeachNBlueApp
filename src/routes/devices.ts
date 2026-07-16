import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { registerDeviceHandler } from '../controllers/deviceController';

const router = Router();

router.post('/', authenticate, registerDeviceHandler);

export default router;
