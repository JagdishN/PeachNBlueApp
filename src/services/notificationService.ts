import { CommunicationMessageType } from '../types/enums';
import prisma from '../prisma/client';
import { sendSms, sendWhatsApp } from '../lib/twilioClient';

interface NotifiableCustomer {
  id: string;
  phoneNumber: string;
  whatsappNumber: string | null;
}

// Sends a customer notification over WhatsApp and SMS independently — both
// channels always fire, never one as a fallback for the other (CLAUDE.md).
// Each channel writes its own communications_log row, per the schema's
// two-rows-per-event design, regardless of whether that channel succeeded.
export const sendNotification = async (
  customer: NotifiableCustomer,
  messageType: CommunicationMessageType,
  body: string,
  orderId?: string
): Promise<void> => {
  const whatsappTarget = customer.whatsappNumber ?? customer.phoneNumber;

  const [whatsappResult, smsResult] = await Promise.allSettled([
    sendWhatsApp(whatsappTarget, body),
    sendSms(customer.phoneNumber, body),
  ]);

  await Promise.all([
    prisma.communicationLog.create({
      data: {
        customerId: customer.id,
        orderId,
        messageType,
        channel: 'whatsapp',
        status: whatsappResult.status === 'fulfilled' ? 'sent' : 'failed',
      },
    }),
    prisma.communicationLog.create({
      data: {
        customerId: customer.id,
        orderId,
        messageType,
        channel: 'sms',
        status: smsResult.status === 'fulfilled' ? 'sent' : 'failed',
      },
    }),
  ]);

  if (whatsappResult.status === 'rejected') {
    console.error(`Failed to send ${messageType} via WhatsApp to customer ${customer.id}:`, whatsappResult.reason);
  }

  if (smsResult.status === 'rejected') {
    console.error(`Failed to send ${messageType} via SMS to customer ${customer.id}:`, smsResult.reason);
  }
};
