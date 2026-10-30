import Razorpay from 'razorpay';
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } from '../config';

// Lazy singleton — Razorpay's constructor hard-throws if key_id/key_secret
// are empty (unlike msg91Client.ts, which tolerates empty credentials at
// module load and only fails when actually sending). Constructing eagerly
// at module load would crash the whole server on boot whenever Razorpay
// isn't configured yet, same as config/index.ts's MSG91/Supabase vars are
// allowed to be unset (non-fatal warning only) — this keeps that same
// degrade-gracefully behavior instead of being fatal.
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
// documented parameter that hard-restricts accepted methods — confirmed
// against Razorpay's real webhook/payment-link docs (payment-safety review,
// 2026-10-30): there genuinely is no such restriction parameter.
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
    // Payment-safety review Priority 1 / section 4.2: "Explicitly configure
    // Razorpay Payment Links to disallow native partial payments... use the
    // exact parameter name... do not rely on an undocumented default."
    // Confirmed against Razorpay's real API reference (2026-10-30): the
    // parameter is `accept_partial` (boolean, NOT `partial_payment` as an
    // earlier version of this file assumed) — its documented default when
    // omitted is already `false`, so this was never actually accepting
    // partial payments, but setting it explicitly removes the dependency on
    // that default never changing. Partial settlement is handled entirely
    // by this app's own ledger (paymentLedgerService.ts) — a customer who
    // wants to pay only part of the amount does so via staff-recorded
    // cash/bank UPI for the rest, not via Razorpay's own partial-payment UI.
    accept_partial: false,
    notes: { orderId: input.orderId, orderNumber: input.orderNumber },
  });

  return { id: link.id, shortUrl: link.short_url };
};

export interface CancelResult {
  success: boolean;
  /** True when the provider's response was ambiguous/timed out rather than
   * a clean success or a clean "already settled" failure — the caller must
   * NOT treat this the same as success (payment-safety review 4.4: "prevent
   * the application from falsely reporting that the link was safely
   * disabled"). */
  uncertain: boolean;
  error?: string;
}

// Previously best-effort/void (swallowed every failure) — invoiceService.ts's
// existing reissue call site still wants that exact behavior (a cancel
// failure there must never block a new, correct link from going out), so it
// keeps using this function and simply ignores the returned result.
// paymentLinkLifecycle.ts (new, 2026-10-30) is the one caller that actually
// needs to know whether cancellation succeeded, to decide whether to open a
// cancellation_uncertain reconciliation exception — see payment-safety
// review 4.3: "do not assume cancelling a link reverses an already
// initiated payment" / "handle... network timeouts, and uncertain provider
// responses."
export const cancelPaymentLink = async (paymentLinkId: string): Promise<CancelResult> => {
  try {
    const result = await getClient().paymentLink.cancel(paymentLinkId);
    // Razorpay returns the link's new status in the response — "cancelled"
    // confirms the provider actually applied it; anything else (including a
    // 200 with an unexpected status) is treated as uncertain rather than
    // trusted blindly.
    if (result?.status === 'cancelled') {
      return { success: true, uncertain: false };
    }
    console.warn(`Razorpay payment link ${paymentLinkId} cancel returned unexpected status: ${result?.status}`);
    return { success: false, uncertain: true, error: `Unexpected status: ${result?.status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A network timeout or 5xx is genuinely uncertain (the cancel may or may
    // not have been applied server-side); a clean 4xx like "already
    // cancelled/paid" is a real failure, not an uncertain one — but without
    // reliably distinguishing Razorpay's error shapes here, treat every
    // thrown error as uncertain (the safer default per 4.3) rather than
    // guessing it was a clean failure.
    console.error(`Failed to cancel Razorpay payment link ${paymentLinkId}:`, err);
    return { success: false, uncertain: true, error: message };
  }
};

// Webhook signature verification — MUST run against the raw, unparsed
// request body (Razorpay's own docs: "Do not parse or cast the webhook
// request body" before computing the HMAC). See routes/webhooks.ts's
// express.raw() and webhookController.ts, which pass rawBody straight from
// that Buffer without ever JSON.parse-ing it first.
export const verifyWebhookSignature = (rawBody: string, signature: string): boolean => {
  return Razorpay.validateWebhookSignature(rawBody, signature, RAZORPAY_WEBHOOK_SECRET);
};
