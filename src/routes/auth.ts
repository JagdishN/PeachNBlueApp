import { Router } from 'express';
import { refreshAccessToken, requestOtp, verifyOtp } from '../controllers/authController';

const router = Router();

router.post('/request-otp', requestOtp);
router.post('/verify-otp', verifyOtp);
router.post('/refresh-token', refreshAccessToken);

export default router;
