import crypto from 'crypto';
import redis from '../lib/redis';
import { sendWhatsAppTemplate, formatMsg91Error, resolveWhatsappFrom } from '../lib/msg91Client';
import { MSG91_TEMPLATES } from '../constants/msg91Templates';
import { MOCK_AUTH } from '../config';

const OTP_KEY_PREFIX = 'otp:';
const RATE_LIMIT_KEY_PREFIX = 'otp:ratelimit:';
const RATE_LIMIT_MAX_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

// Mirrors the Redis-backed store below so MOCK_AUTH can run with no Redis
// instance available at all — local testing only, see config.MOCK_AUTH.
const mockOtpStore = new Map<string, string>();
const mockRateLimitStore = new Map<string, number>();

export const generateOtp = (): string => {
  return crypto.randomInt(100000, 999999).toString();
};

export const saveOtpAttempt = async (phoneNumber: string, otp: string, expiryMinutes: number): Promise<void> => {
  if (MOCK_AUTH) {
    mockOtpStore.set(phoneNumber, otp);
    return;
  }

  await redis.set(`${OTP_KEY_PREFIX}${phoneNumber}`, otp, 'EX', expiryMinutes * 60);
};

export const verifyOtpCode = async (phoneNumber: string, otp: string): Promise<boolean> => {
  if (MOCK_AUTH) {
    const storedOtp = mockOtpStore.get(phoneNumber);
    if (!storedOtp || storedOtp !== otp) {
      return false;
    }
    mockOtpStore.delete(phoneNumber);
    return true;
  }

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
  if (MOCK_AUTH) {
    const count = (mockRateLimitStore.get(phoneNumber) ?? 0) + 1;
    mockRateLimitStore.set(phoneNumber, count);
    return count <= RATE_LIMIT_MAX_PER_HOUR;
  }

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
// customer-facing comms. WhatsApp-only (CLAUDE.md "Messaging migration —
// MSG91, WhatsApp-only") — SMS is no longer sent anywhere, including here;
// this is a deliberate, confirmed accepted-risk decision (a staff member
// has no fallback channel if WhatsApp delivery fails), not an oversight —
// do not silently reintroduce an SMS fallback later without checking.
export const sendOtpViaChannels = async (phoneNumber: string, otp: string): Promise<void> => {
  try {
    // Login OTP is an authentication mechanism, not a branch/order-scoped
    // customer or admin message — the per-branch WhatsApp sender
    // requirement (CLAUDE.md "Branches") is about messages tied to a
    // specific branch's order/customer activity, which a login attempt
    // isn't. Sent from the shared fallback number rather than resolving a
    // branch here.
    await sendWhatsAppTemplate({
      toPhoneNumber: phoneNumber,
      fromNumber: resolveWhatsappFrom(undefined),
      templateName: MSG91_TEMPLATES.otpLogin.name,
      language: MSG91_TEMPLATES.otpLogin.language,
      bodyVariables: [otp],
      // account_login's real template definition (pulled directly from
      // MSG91, 2026-09-02, "Live send verification") has a mandatory
      // BUTTONS component (Meta's OTP "Copy Code" one-tap autofill) whose
      // {{1}} is the same OTP code, not a link — see
      // MSG91_TEMPLATES.otpLogin.requiresOtpButton. Omitting this is
      // plausibly why every OTP test before this fix failed even once the
      // namespace bug was fixed.
      buttonUrlParam: MSG91_TEMPLATES.otpLogin.requiresOtpButton ? otp : undefined,
    });
  } catch (err) {
    console.error(`Failed to send OTP via WhatsApp to ${phoneNumber}: ${formatMsg91Error(err)}`);
  }
};
