import twilio from 'twilio';
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM, TWILIO_WHATSAPP_FROM } from '../config';

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

export const sendWhatsApp = async (toPhoneNumber: string, body: string): Promise<void> => {
  await client.messages.create({
    from: `whatsapp:${TWILIO_WHATSAPP_FROM}`,
    to: `whatsapp:${toPhoneNumber}`,
    body,
  });
};

export const sendSms = async (toPhoneNumber: string, body: string): Promise<void> => {
  await client.messages.create({
    from: TWILIO_SMS_FROM,
    to: toPhoneNumber,
    body,
  });
};
