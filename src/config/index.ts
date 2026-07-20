import dotenv from 'dotenv';

dotenv.config();

// `??` alone doesn't catch an env var that's *present but empty* (e.g.
// `JWT_SECRET=` in .env) — that's '' , not null/undefined, so `??` never
// falls back to `fallback`. An empty secret is never useful (jsonwebtoken
// rejects it outright for JWT_SECRET), so treat '' the same as unset here.
const getEnv = (key: string, fallback = ''): string => {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
};

export const NODE_ENV = getEnv('NODE_ENV', 'development');
export const PORT = Number(getEnv('PORT', '4000'));

// Bypasses the DB user lookup and Redis-backed OTP storage with an in-memory
// mock, for local testing without a provisioned Postgres/Redis. Hard-disabled
// in production regardless of the env var value.
export const MOCK_AUTH = NODE_ENV !== 'production' && getEnv('MOCK_AUTH', 'false') === 'true';
export const DATABASE_URL = getEnv('DATABASE_URL');
export const JWT_SECRET = getEnv('JWT_SECRET', 'replace-with-secret');
export const JWT_EXPIRES_IN = getEnv('JWT_EXPIRES_IN', '30m');
export const OTP_EXPIRY_MINUTES = Number(getEnv('OTP_EXPIRY_MINUTES', '10'));

export const REDIS_URL = getEnv('REDIS_URL', 'redis://localhost:6379');

export const TWILIO_ACCOUNT_SID = getEnv('TWILIO_ACCOUNT_SID');
export const TWILIO_AUTH_TOKEN = getEnv('TWILIO_AUTH_TOKEN');
export const TWILIO_WHATSAPP_FROM = getEnv('TWILIO_WHATSAPP_FROM');
export const TWILIO_SMS_FROM = getEnv('TWILIO_SMS_FROM');

// New-style Supabase API keys (sb_publishable_… / sb_secret_…) for
// @supabase/server — no hardcoded fallback here on purpose: these are live
// secrets, so they must come from environment variables only (CLAUDE.md
// security baseline), never a source-committed default.
export const SUPABASE_URL = getEnv('SUPABASE_URL');
export const SUPABASE_PUBLISHABLE_KEY = getEnv('SUPABASE_PUBLISHABLE_KEY');
export const SUPABASE_SECRET_KEY = getEnv('SUPABASE_SECRET_KEY');
export const SUPABASE_JWKS_URL = getEnv('SUPABASE_JWKS_URL');

export const RAZORPAY_KEY_ID = getEnv('RAZORPAY_KEY_ID');
export const RAZORPAY_KEY_SECRET = getEnv('RAZORPAY_KEY_SECRET');
export const RAZORPAY_WEBHOOK_SECRET = getEnv('RAZORPAY_WEBHOOK_SECRET');

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required in environment variables.');
}

if (!JWT_SECRET || JWT_SECRET === 'replace-with-secret') {
  console.warn('Warning: using a fallback JWT_SECRET. Set JWT_SECRET in environment variables for production.');
}

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  console.warn('Warning: TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not set. OTP and customer notifications will fail to send.');
}

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY) {
  console.warn('Warning: SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY/SUPABASE_SECRET_KEY not fully set. Supabase-backed features will be unavailable.');
}

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.warn('Warning: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not set. Invoice payment links will fail to generate.');
}
