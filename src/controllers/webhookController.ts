import { Request, Response } from 'express';
import prisma from '../prisma/client';
import { verifyWebhookSignature } from '../lib/razorpayClient';
import { recordOnlinePayment } from '../services/orderService';
import { recordUnmatchedPayment } from '../services/unmatchedPaymentService';
import { PaymentMethod } from '../types/enums';

// payments.payment_method / orders.payment_method both carry a live Postgres
// CHECK constraint restricting to exactly these 4 values (CLAUDE.md
// "Database sync status") — confirmed via Razorpay's own docs that Payment
// Links have no API-level way to restrict which methods a customer can pay
// with (Card, UPI, NetBanking, Wallet, EMI, Pay Later, Bank Transfer are all
// possible), so an unmapped method is a real, reachable case, not a
// theoretical one. Falls back to 'credit_card' rather than crashing the
// webhook — the actual Razorpay method is preserved in Payment.notes
// (unconstrained free text) so nothing is silently lost, just approximated
// in the constrained column. See CLAUDE.md for the full note on this gap.
const RAZORPAY_METHOD_MAP: Record<string, PaymentMethod> = {
  card: 'credit_card',
  netbanking: 'net_banking',
  upi: 'upi',
};

const mapRazorpayMethod = (method: string | undefined): PaymentMethod => {
  if (method && RAZORPAY_METHOD_MAP[method]) {
    return RAZORPAY_METHOD_MAP[method];
  }
  console.warn(`[razorpay webhook] Unmapped payment method "${method}" — falling back to 'credit_card'.`);
  return 'credit_card';
};

// Correlates via the Payment Link id we generated and stored on Invoice
// (razorpayPaymentLinkId), NOT via payload.payment.entity.notes — Razorpay's
// docs don't confirm notes set on a Payment Link are reliably echoed onto
// the resulting Payment entity, but payload.payment_link.entity.id is
// guaranteed present on this event and is an id we fully control end to end.
//
// CONFIRMED DEFECT, FIXED (2026-10-31): the active-link lookup alone used to
// be the ONLY resolution path. retireOrReplaceLink (paymentLinkLifecycle.ts)
// clears Invoice.razorpayPaymentLinkId whenever a link is retired — an admin
// waiver, a reissue, or a cash/bank_upi settlement that replaced the link —
// so a LATE webhook for that now-retired link id used to find no invoice at
// all and was silently logged-and-dropped. PaymentLinkHistory already
// retains the original link->invoice mapping for exactly this case (every
// retirement writes a row there before the link is cleared), so the
// fallback below resolves the same invoice the active lookup would have
// found before retirement — a genuinely verified receipt is never silently
// discarded just because its link is no longer the CURRENT one.
const resolveInvoiceForLink = async (linkId: string) => {
  const active = await prisma.invoice.findFirst({ where: { razorpayPaymentLinkId: linkId } });
  if (active) {
    return active;
  }

  const historical = await prisma.paymentLinkHistory.findFirst({
    where: { razorpayPaymentLinkId: linkId, invoiceId: { not: null } },
    orderBy: { retiredAt: 'desc' },
  });
  if (!historical?.invoiceId) {
    return null;
  }

  return prisma.invoice.findUnique({ where: { id: historical.invoiceId } });
};

const handlePaymentLinkPaid = async (body: any): Promise<void> => {
  const linkEntity = body?.payload?.payment_link?.entity;
  const paymentEntity = body?.payload?.payment?.entity;

  if (!linkEntity?.id || !paymentEntity?.id) {
    console.warn('[razorpay webhook] payment_link.paid missing payment_link/payment entity — ignoring.');
    return;
  }

  // Validate the actual provider-side settlement status rather than trusting
  // the event name alone — Razorpay's docs don't guarantee
  // payment.entity.status is always "captured" on this event, only that it
  // usually is by the time payment_link.paid fires. Anything else (e.g. a
  // payment still "authorized" but not yet captured) isn't a confirmed
  // receipt yet; ignore it now and let a later event for the same payment
  // (or the eventual payment_link.paid redelivery once it IS captured)
  // record it for real.
  if (paymentEntity.status && paymentEntity.status !== 'captured') {
    console.warn(
      `[razorpay webhook] payment_link.paid with payment.status="${paymentEntity.status}" (expected "captured") — ` +
        `ignoring link=${linkEntity.id} payment=${paymentEntity.id}.`
    );
    return;
  }

  const invoice = await resolveInvoiceForLink(linkEntity.id);

  if (!invoice) {
    // Genuinely unresolvable via either the active link or
    // PaymentLinkHistory — should not happen in normal operation (Peach &
    // Blue controls every link it ever creates and always records one of
    // those two mappings). Never silently discarded: persisted to a durable
    // queue for manual investigation, idempotent on razorpayPaymentId so a
    // redelivered webhook for the same unresolved payment doesn't duplicate.
    // Amount is taken directly from Razorpay's own paise integer
    // (paymentEntity.amount) rather than round-tripping through rupees, to
    // avoid any floating-point drift on a receipt nothing has reconciled yet.
    await recordUnmatchedPayment({
      razorpayPaymentId: paymentEntity.id,
      razorpayPaymentLinkId: linkEntity.id,
      amountPaise: BigInt(paymentEntity.amount),
      rawPayload: body,
    });
    console.error(
      `[razorpay webhook] No invoice found (active or historical) for payment link ${linkEntity.id} — ` +
        `payment ${paymentEntity.id} persisted to the unmatched-provider-payments queue for manual review.`
    );
    return;
  }

  const method = mapRazorpayMethod(paymentEntity.method);
  const amountPaid = Number(paymentEntity.amount) / 100;

  const result = await recordOnlinePayment(invoice.orderId, method, amountPaid, paymentEntity.id, paymentEntity.method);

  if (result.status === 'monthly_billing_anomaly') {
    console.error(
      `[razorpay webhook] Order ${invoice.orderId} is monthly-billing but its Razorpay link ${linkEntity.id} ` +
        'was paid anyway (a legacy link from before real links were disabled for these customers). ' +
        'A PaymentReconciliationException row was created — needs manual admin review to avoid double-counting against the ledger.'
    );
  } else if (result.status === 'order_not_found') {
    console.error(`[razorpay webhook] Invoice ${invoice.id} references order ${invoice.orderId}, which no longer exists.`);
  } else if (result.status === 'duplicate_webhook') {
    // Genuinely benign — Razorpay's own documented at-least-once delivery
    // behavior for the exact same payment. Payment.razorpayPaymentId's
    // unique constraint is the real backstop here regardless of this log.
    console.log(`[razorpay webhook] Duplicate delivery for an already-recorded payment on order ${invoice.orderId} — no-op.`);
  } else if (result.status === 'overpayment_recorded') {
    console.error(
      `[razorpay webhook] Order ${invoice.orderId}: a real Razorpay payment was recorded but the invoice was already ` +
        'fully settled by another method. A PaymentReconciliationException row was created — needs manual review, ' +
        'this is a genuine overpayment, not a duplicate.'
    );
  } else {
    console.log(`[razorpay webhook] payment_link.paid for order ${invoice.orderId}: ${result.status}`);
  }
};

const handlePaymentFailed = (body: any): void => {
  const paymentEntity = body?.payload?.payment?.entity;
  const linkEntity = body?.payload?.payment_link?.entity;

  // Log-only, per design — a failed payment attempt is not a rejected
  // order, the customer may simply retry the same link.
  console.warn(
    `[razorpay webhook] payment.failed — link=${linkEntity?.id ?? 'unknown'} ` +
      `payment=${paymentEntity?.id ?? 'unknown'} error=${paymentEntity?.error_code ?? 'unknown'} ` +
      `(${paymentEntity?.error_description ?? 'no description'})`
  );
};

export const razorpayWebhookHandler = async (req: Request, res: Response): Promise<void> => {
  // req.body is a raw Buffer here — routes/webhooks.ts mounts express.raw()
  // for this route specifically, ahead of server.ts's global express.json(),
  // exactly because signature verification needs the untouched raw bytes.
  const rawBody = (req.body as Buffer).toString('utf-8');
  const signature = req.headers['x-razorpay-signature'];

  if (typeof signature !== 'string' || !verifyWebhookSignature(rawBody, signature)) {
    res.status(400).json({ error: 'Invalid webhook signature' });
    return;
  }

  const body = JSON.parse(rawBody);

  switch (body.event) {
    case 'payment_link.paid':
      await handlePaymentLinkPaid(body);
      break;
    case 'payment.failed':
      handlePaymentFailed(body);
      break;
    default:
      // Ack anything we don't act on (e.g. payment_link.expired,
      // order.paid) rather than leaving Razorpay to retry an event we were
      // never going to do anything with.
      console.log(`[razorpay webhook] Ignoring unhandled event: ${body.event}`);
  }

  res.status(200).json({ received: true });
};
