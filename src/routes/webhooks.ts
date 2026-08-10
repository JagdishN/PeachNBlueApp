import { Router, raw } from 'express';
import { razorpayWebhookHandler } from '../controllers/webhookController';

const router = Router();

// express.raw(), not express.json() — signature verification needs the
// exact raw bytes Razorpay sent (see razorpayClient.ts's
// verifyWebhookSignature and webhookController.ts). This only works because
// server.ts mounts this router BEFORE its global express.json() — once that
// runs first for a request, the raw body is gone.
router.post('/razorpay', raw({ type: 'application/json' }), razorpayWebhookHandler);

export default router;
