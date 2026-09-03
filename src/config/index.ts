import dotenv from 'dotenv';

// override: true — without it, dotenv only fills in vars NOT already present
// in process.env, so a stale value inherited from whatever process tree
// launched this server (e.g. an old DATABASE_URL pointing at a long-gone
// local Postgres test instance) silently wins over .env forever, even
// across every ts-node-dev respawn. .env is this project's single source of
// truth for LOCAL DEVELOPMENT (see CLAUDE.md) — it must always win over
// inherited shell state there.
//
// In production, skip loading a .env file entirely — real secrets must come
// from the hosting platform's own environment/secret manager (CLAUDE.md
// security baseline), never a file on disk. This isn't just a style
// preference: with override:true unconditional, a stray/rogue .env that
// somehow ended up on a production host (e.g. an overly broad `COPY . .` in
// a Dockerfile, or an accidentally-committed file) would silently beat the
// platform's real injected secrets — the opposite of the override's original
// intent. `npm start` (see package.json) sets NODE_ENV=production via
// cross-env specifically so this check is reliable regardless of what the
// hosting platform does or doesn't set on its own.
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ override: true });
}

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
// Fixed 2-day session from login (CLAUDE.md security baseline) — the mobile
// app silently exchanges this for new access tokens until it itself
// expires, at which point re-login (OTP) is required. This is never
// re-signed/extended on use, so it's a fixed window from login time, not a
// rolling one.
export const JWT_REFRESH_EXPIRES_IN = getEnv('JWT_REFRESH_EXPIRES_IN', '2d');
export const OTP_EXPIRY_MINUTES = Number(getEnv('OTP_EXPIRY_MINUTES', '10'));

export const REDIS_URL = getEnv('REDIS_URL', 'redis://localhost:6379');

// Twilio removed (CLAUDE.md "Messaging migration — MSG91, WhatsApp-only,
// 2026-08-10"): WhatsApp is now sent via MSG91's WhatsApp API, and SMS is
// no longer sent anywhere, including OTP login — a deliberate, confirmed
// decision, not an oversight (accepted risk: no fallback channel if
// WhatsApp delivery fails).
export const MSG91_AUTH_KEY = getEnv('MSG91_AUTH_KEY');
// Shared/default WhatsApp sending number — used only when a branch has no
// whatsappNumber of its own configured yet (CLAUDE.md "Branches"). Must be
// one of the numbers registered under the MSG91/Meta WABA this authkey
// belongs to.
export const MSG91_INTEGRATED_NUMBER = getEnv('MSG91_INTEGRATED_NUMBER');
// The WABA's namespace GUID (assigned by Meta at WABA creation, same value
// for every template under it) — REQUIRED for real delivery, discovered
// 2026-09-02 via a live send comparison (CLAUDE.md "Live send verification
// — namespace fix"): omitting it lets MSG91's own API validation accept the
// request (200 "success") but Meta silently drops delivery downstream,
// since name+language alone apparently isn't enough for MSG91 to resolve
// which approved template to actually send. Get this from MSG91's
// dashboard (Manage Templates, or a successful send's request payload) if
// it ever needs to change (e.g. after another WABA rebuild).
export const MSG91_WABA_NAMESPACE = getEnv('MSG91_WABA_NAMESPACE');

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

if (!MSG91_AUTH_KEY || !MSG91_INTEGRATED_NUMBER) {
  console.warn('Warning: MSG91_AUTH_KEY/MSG91_INTEGRATED_NUMBER not set. OTP and customer notifications will fail to send.');
}

if (!MSG91_WABA_NAMESPACE) {
  console.warn(
    'Warning: MSG91_WABA_NAMESPACE not set. Sends may return "success" from MSG91 but silently fail to actually deliver (see CLAUDE.md "Live send verification — namespace fix").'
  );
}

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY) {
  console.warn('Warning: SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY/SUPABASE_SECRET_KEY not fully set. Supabase-backed features will be unavailable.');
}

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.warn('Warning: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not set. Invoice payment links will fail to generate.');
}
