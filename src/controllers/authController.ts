import { Request, Response } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import prisma from '../prisma/client';
import {
  JWT_EXPIRES_IN,
  JWT_REFRESH_EXPIRES_IN,
  JWT_SECRET,
  MOCK_AUTH,
  NODE_ENV,
  OTP_EXPIRY_MINUTES,
  REVIEWER_TEST_OTP,
  REVIEWER_TEST_PHONE,
} from '../config';
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

// App-store/Play-Store review bypass — see CLAUDE.md "Reviewer test-number
// OTP bypass". Exact-match only, against one specific non-real phone number
// (never a pattern/wildcard/NODE_ENV toggle) — an empty REVIEWER_TEST_PHONE
// (the default, outside of an active store review) means this never
// matches anything, for any input.
const isReviewerTestPhone = (phoneNumber: string): boolean =>
  REVIEWER_TEST_PHONE !== '' && phoneNumber === REVIEWER_TEST_PHONE;

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

  // Reviewer bypass: skip rate-limiting and OTP generation/save entirely —
  // nothing is ever stored for this number, since verifyOtp below checks the
  // fixed REVIEWER_TEST_OTP directly rather than anything from
  // saveOtpAttempt/verifyOtpCode's Redis-backed store. No real MSG91 send
  // happens either way, so no WhatsApp message goes out and no MSG91
  // credits/quota are spent on a number that could never receive it.
  if (isReviewerTestPhone(phoneNumber)) {
    res.status(200).json({ message: 'OTP sent if the user exists' });
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

  // Reviewer bypass: exact phone match AND exact fixed-OTP match, checked
  // directly instead of through verifyOtpCode — requestOtp above never saved
  // anything to Redis/the mock store for this number. Falls through to the
  // exact same JWT-issuance code below as a real verification (item 3 of the
  // spec: "same code path... not a separate insecure branch") rather than a
  // parallel/weaker login path.
  const isBypass = isReviewerTestPhone(phoneNumber);
  const verified = isBypass ? otp === REVIEWER_TEST_OTP : await verifyOtpCode(phoneNumber, otp);

  if (!verified) {
    res.status(401).json({ error: 'Invalid or expired OTP' });
    return;
  }

  if (isBypass) {
    // Deliberately loud, visible logging (item 6 of the spec) — this is the
    // one phone number in the whole system that authenticates without a
    // real WhatsApp OTP, so every successful use should stand out in server
    // logs rather than blend into routine request logging.
    console.warn(`[REVIEWER_BYPASS] Test-number OTP login used: phone=${phoneNumber} at=${new Date().toISOString()}`);
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
