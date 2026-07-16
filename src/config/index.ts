import dotenv from 'dotenv';

dotenv.config();

const getEnv = (key: string, fallback = ''): string => process.env[key] ?? fallback;

export const PORT = Number(getEnv('PORT', '4000'));
export const DATABASE_URL = getEnv('DATABASE_URL');
export const JWT_SECRET = getEnv('JWT_SECRET', 'replace-with-secret');
export const JWT_EXPIRES_IN = getEnv('JWT_EXPIRES_IN', '30m');
export const OTP_EXPIRY_MINUTES = Number(getEnv('OTP_EXPIRY_MINUTES', '10'));

export const REDIS_URL = getEnv('REDIS_URL', 'redis://localhost:6379');

export const TWILIO_ACCOUNT_SID = getEnv('TWILIO_ACCOUNT_SID');
export const TWILIO_AUTH_TOKEN = getEnv('TWILIO_AUTH_TOKEN');
export const TWILIO_WHATSAPP_FROM = getEnv('TWILIO_WHATSAPP_FROM');
export const TWILIO_SMS_FROM = getEnv('TWILIO_SMS_FROM');

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required in environment variables.');
}

if (!JWT_SECRET || JWT_SECRET === 'replace-with-secret') {
  console.warn('Warning: using a fallback JWT_SECRET. Set JWT_SECRET in environment variables for production.');
}

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  console.warn('Warning: TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not set. OTP and customer notifications will fail to send.');
}
