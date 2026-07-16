import crypto from 'crypto';
import redis from '../lib/redis';
import { sendSms, sendWhatsApp } from '../lib/twilioClient';

const OTP_KEY_PREFIX = 'otp:';
const RATE_LIMIT_KEY_PREFIX = 'otp:ratelimit:';
const RATE_LIMIT_MAX_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

export const generateOtp = (): string => {
  return crypto.randomInt(100000, 999999).toString();
};

export const saveOtpAttempt = async (phoneNumber: string, otp: string, expiryMinutes: number): Promise<void> => {
  await redis.set(`${OTP_KEY_PREFIX}${phoneNumber}`, otp, 'EX', expiryMinutes * 60);
};

export const verifyOtpCode = async (phoneNumber: string, otp: string): Promise<boolean> => {
  const key = `${OTP_KEY_PREFIX}${phoneNumber}`;
  const storedOtp = await redis.get(key);

  if (!storedOtp || storedOtp !== otp) {
    return false;
  }

  await redis.del(key);
  return true;
};

// Rate-limits OTP requests per phone number (CLAUDE.md: max 5/hour). Returns
// false once the caller should be rejected with a 429.
export const checkOtpRateLimit = async (phoneNumber: string): Promise<boolean> => {
  const key = `${RATE_LIMIT_KEY_PREFIX}${phoneNumber}`;
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  }

  return count <= RATE_LIMIT_MAX_PER_HOUR;
};

// OTP goes to a staff/admin phone (users table), not a customer, so it is
// deliberately NOT logged to communications_log — that table's customer_id
// is NOT NULL and its message_type enum has no "otp" value; it's scoped to
// customer-facing comms. Both channels always fire, never one as a fallback
// for the other, per CLAUDE.md.
export const sendOtpViaChannels = async (phoneNumber: string, otp: string): Promise<void> => {
  const body = `Your Peach & Blue login code is ${otp}. It expires shortly — do not share this code.`;

  const [whatsappResult, smsResult] = await Promise.allSettled([
    sendWhatsApp(phoneNumber, body),
    sendSms(phoneNumber, body),
  ]);

  if (whatsappResult.status === 'rejected') {
    console.error(`Failed to send OTP via WhatsApp to ${phoneNumber}:`, whatsappResult.reason);
  }

  if (smsResult.status === 'rejected') {
    console.error(`Failed to send OTP via SMS to ${phoneNumber}:`, smsResult.reason);
  }
};
