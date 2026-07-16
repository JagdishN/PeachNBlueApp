import { Request, Response } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import prisma from '../prisma/client';
import { JWT_EXPIRES_IN, JWT_SECRET, OTP_EXPIRY_MINUTES } from '../config';
import { checkOtpRateLimit, generateOtp, saveOtpAttempt, sendOtpViaChannels, verifyOtpCode } from '../services/otpService';

const createToken = (user: { id: string; role: 'staff' | 'admin'; branchId: string | null }) => {
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      branchId: user.branchId,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN as SignOptions['expiresIn'] }
  );
};

export const requestOtp = async (req: Request, res: Response): Promise<void> => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    res.status(400).json({ error: 'phoneNumber is required' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { phoneNumber } });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const withinLimit = await checkOtpRateLimit(phoneNumber);

  if (!withinLimit) {
    res.status(429).json({ error: 'Too many OTP requests. Try again later.' });
    return;
  }

  const otp = generateOtp();
  await saveOtpAttempt(phoneNumber, otp, OTP_EXPIRY_MINUTES);
  await sendOtpViaChannels(phoneNumber, otp);

  res.status(200).json({ message: 'OTP sent if the user exists' });
};

export const verifyOtp = async (req: Request, res: Response): Promise<void> => {
  const { phoneNumber, otp } = req.body;

  if (!phoneNumber || !otp) {
    res.status(400).json({ error: 'phoneNumber and otp are required' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { phoneNumber } });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const verified = await verifyOtpCode(phoneNumber, otp);

  if (!verified) {
    res.status(401).json({ error: 'Invalid or expired OTP' });
    return;
  }

  const token = createToken({ id: user.id, role: user.role, branchId: user.branchId });

  res.status(200).json({ token, user: { id: user.id, role: user.role, branchId: user.branchId, fullName: user.fullName } });
};
