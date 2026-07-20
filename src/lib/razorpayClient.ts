import Razorpay from 'razorpay';
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } from '../config';

// Lazy singleton — Razorpay's constructor hard-throws if key_id/key_secret
// are empty (unlike twilioClient.ts's client, which tolerates empty
// credentials at construction and only fails when actually sending).
// Constructing eagerly at module load would crash the whole server on boot
// whenever Razorpay isn't configured yet, same as config/index.ts's
// Twilio/Supabase vars are allowed to be unset (non-fatal warning only) —
// this keeps that same degrade-gracefully behavior instead of being fatal.
let client: Razorpay | null = null;

const getClient = (): Razorpay => {
  if (!client) {
    client = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
  }
  return client;
};

interface CreatePaymentLinkInput {
  amount: number;
  orderNumber: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
}

interface PaymentLink {
  id: string;
  shortUrl: string;
}

// CLAUDE.md: the invoice payment link should support Card and Net/Online
// Banking. Razorpay's Payment Links API (unlike Orders/Checkout) has no
// documented parameter that hard-restricts accepted methods — this has not
// been verified against a live sandbox (no RAZORPAY_KEY_ID/SECRET configured
// yet). Flagged for a real-credentials check; the description/notes below at
// least communicate intent to whoever reconciles the link in the dashboard.
export const createPaymentLink = async (input: CreatePaymentLinkInput): Promise<PaymentLink> => {
  const link = await getClient().paymentLink.create({
    amount: Math.round(input.amount * 100),
    currency: 'INR',
    description: `Peach & Blue order ${input.orderNumber}`,
    customer: {
      name: input.customerName,
      contact: input.customerPhone,
    },
    // We send our own WhatsApp/SMS via notificationService (CLAUDE.md: both
    // channels always fire, never through a third-party template) — disable
    // Razorpay's own notification so the customer isn't messaged twice.
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: { orderId: input.orderId, orderNumber: input.orderNumber },
  });

  return { id: link.id, shortUrl: link.short_url };
};

// Best-effort — CLAUDE.md: "Cancel/expire the old payment link if the
// Razorpay API supports it — this is the part that actually prevents a
// double-payment or stale-amount-payment risk, not just cosmetic reissuing."
// A cancel failure must not block the rest of the reissue flow (a new,
// correct link still gets sent either way), so this swallows and logs
// rather than throwing.
export const cancelPaymentLink = async (paymentLinkId: string): Promise<void> => {
  try {
    await getClient().paymentLink.cancel(paymentLinkId);
  } catch (err) {
    console.error(`Failed to cancel Razorpay payment link ${paymentLinkId}:`, err);
  }
};
