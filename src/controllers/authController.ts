import { Request, Response } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import prisma from '../prisma/client';
import { JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN, JWT_SECRET, MOCK_AUTH, NODE_ENV, OTP_EXPIRY_MINUTES } from '../config';
import { checkOtpRateLimit, generateOtp, saveOtpAttempt, sendOtpViaChannels, verifyOtpCode } from '../services/otpService';
import { UserRole } from '../types/enums';

// `type: 'access'` distinguishes this from a refresh token at verification
// time (middleware/auth.ts rejects a refresh token presented as an access
// token) — without it, a stolen refresh token could double as a long-lived
// access token for its full 2-day life instead of only being exchangeable
// for short-lived access tokens.
const createAccessToken = (user: { id: string; role: 'staff' | 'admin'; branchId: string | null }) => {
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      branchId: user.branchId,
      type: 'access',
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN as SignOptions['expiresIn'] }
  );
};

// Deliberately minimal payload (just userId + type) — role/branchId are
// re-read from the DB on every refresh (refreshAccessToken below), not
// baked into this longer-lived token, so a role/branch change takes effect
// on the very next silent refresh rather than staying stale for 2 days.
const createRefreshToken = (userId: string) => {
  return jwt.sign({ userId, type: 'refresh' }, JWT_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn'],
  });
};

export const requestOtp = async (req: Request, res: Response): Promise<void> => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    res.status(400).json({ error: 'phoneNumber is required' });
    return;
  }

  // Role always comes from the real users row — MOCK_AUTH only shortcuts
  // OTP generation/delivery below, never who the phone number belongs to.
  // A phone number not in the DB gets the same 404 either way.
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

  // MOCK_AUTH uses a fixed code and skips MSG91 entirely — there are no real
  // credentials configured for it to send with, and the resulting errors
  // just bury the dev log line below.
  const otp = MOCK_AUTH ? '123456' : generateOtp();
  await saveOtpAttempt(phoneNumber, otp, OTP_EXPIRY_MINUTES);

  if (!MOCK_AUTH) {
    await sendOtpViaChannels(phoneNumber, otp);
  }

  if (NODE_ENV !== 'production') {
    console.log(`[dev] OTP for ${phoneNumber}: ${otp}`);
  }

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

  const token = createAccessToken({ id: user.id, role: user.role as UserRole, branchId: user.branchId });
  const refreshToken = createRefreshToken(user.id);

  res.status(200).json({
    token,
    refreshToken,
    user: { id: user.id, role: user.role, branchId: user.branchId, fullName: user.fullName },
  });
};

// Exchanges a still-valid refresh token for a new short-lived access token —
// this is what lets the mobile app stay signed in silently for the full
// 2-day session (CLAUDE.md security baseline) without re-prompting for OTP
// on every access-token expiry. The refresh token itself is never reissued
// here (no rotation, no extension) — it keeps its own original 2-day
// expiry from login, which is what makes this a fixed window rather than a
// rolling one.
export const refreshAccessToken = async (req: Request, res: Response): Promise<void> => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400).json({ error: 'refreshToken is required' });
    return;
  }

  let payload: { userId: string; type?: string };

  try {
    payload = jwt.verify(refreshToken, JWT_SECRET) as { userId: string; type?: string };
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
    return;
  }

  if (payload.type !== 'refresh') {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
    return;
  }

  // Re-checked against the DB (not trusted from the token) so a role change
  // or account removal takes effect on the next silent refresh rather than
  // staying stale for up to 2 days.
  const user = await prisma.user.findUnique({ where: { id: payload.userId } });

  if (!user) {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
    return;
  }

  const token = createAccessToken({ id: user.id, role: user.role as UserRole, branchId: user.branchId });

  res.status(200).json({ token });
};
