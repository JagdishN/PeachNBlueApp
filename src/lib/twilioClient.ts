import twilio from 'twilio';
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM, TWILIO_WHATSAPP_FROM } from '../config';

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Twilio's RestException carries a specific error `code` (e.g. 21211 invalid
// number, 21608 unverified number on trial, 63016 sandbox not joined) and
// `message` — surfacing these explicitly, not just the generic caught error,
// is what actually helps during trial-mode testing (CLAUDE.md "Twilio trial
// mode"). Callers (notificationService.ts, otpService.ts) log this via the
// rejection reason from Promise.allSettled — this just makes that reason
// readable at a glance instead of a raw object dump.
export const formatTwilioError = (err: unknown): string => {
  const twilioErr = err as { code?: number; message?: string; moreInfo?: string } | undefined;
  if (twilioErr?.code !== undefined) {
    return `Twilio error ${twilioErr.code}: ${twilioErr.message ?? 'no message'}${twilioErr.moreInfo ? ` (${twilioErr.moreInfo})` : ''}`;
  }
  return err instanceof Error ? err.message : String(err);
};

export const sendWhatsApp = async (toPhoneNumber: string, body: string, mediaUrl?: string): Promise<void> => {
  await client.messages.create({
    from: `whatsapp:${TWILIO_WHATSAPP_FROM}`,
    to: `whatsapp:${toPhoneNumber}`,
    body,
    ...(mediaUrl ? { mediaUrl: [mediaUrl] } : {}),
  });
};

export const sendSms = async (toPhoneNumber: string, body: string): Promise<void> => {
  await client.messages.create({
    from: TWILIO_SMS_FROM,
    to: toPhoneNumber,
    body,
  });
};
