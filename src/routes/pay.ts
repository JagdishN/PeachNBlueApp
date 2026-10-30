import { Router } from 'express';
import { resolvePaymentRedirectHandler } from '../controllers/payController';

const router = Router();

// No authenticate() — public by design, see payController.ts.
router.get('/:token', resolvePaymentRedirectHandler);

export default router;
