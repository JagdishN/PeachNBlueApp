import { Request, Response } from 'express';
import prisma from '../prisma/client';

// Minimal inline HTML — this app has no templating engine (it's an API
// server everywhere else), and a customer clicking a WhatsApp link deserves
// something readable, not a bare JSON error. Deliberately plain, no
// external assets/fonts (this is a tiny, rarely-seen page, not worth a
// design pass).
const renderStatusPage = (title: string, message: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Peach & Blue</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #FDF6F0; color: #16305C; margin: 0; padding: 2rem 1.25rem; }
  .card { max-width: 420px; margin: 3rem auto; background: #fff; border-radius: 12px; padding: 2rem 1.5rem; box-shadow: 0 2px 10px rgba(0,0,0,0.08); text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
  p { font-size: 0.95rem; line-height: 1.5; color: #4a5568; margin: 0; }
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;

// Peach & Blue-controlled payment URL (payment-safety review section 5):
// GET /pay/:token. Public, no auth — this is exactly what a customer's
// WhatsApp "Review & Pay" tap is meant to land on once the button's
// configured base URL is pointed here (see the delivery report's note on
// why that last step needs a Meta template change this code can't make by
// itself). Resolves the invoice LIVE at click time rather than redirecting
// to a cached link, so it stays correct across reissues/partial payments
// without needing every already-sent WhatsApp message's link invalidated.
export const resolvePaymentRedirectHandler = async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params;

  const invoice = await prisma.invoice.findUnique({ where: { paymentToken: token } });
  if (!invoice) {
    res.status(404).send(renderStatusPage('Link not found', 'This payment link is invalid or has expired.'));
    return;
  }

  // "Check whether payment-link reconciliation is in progress" — don't let
  // a customer land on a link that might be mid-cancellation/replacement.
  const openTransition = await prisma.paymentLinkTransition.findFirst({
    where: { invoiceId: invoice.id, status: { in: ['pending', 'cancelling_old_link', 'creating_new_link'] } },
  });
  if (openTransition) {
    res
      .status(200)
      .send(renderStatusPage('One moment', 'Your payment is being updated. Please try this link again in a minute.'));
    return;
  }

  if (invoice.invoicePaymentStatus === 'paid') {
    res.status(200).send(renderStatusPage('Already paid', 'This order has already been paid in full. Thank you!'));
    return;
  }

  // "Check whether manual UPI verification requires a temporary hold" — a
  // reported-but-unverified bank_upi payment shouldn't necessarily block a
  // genuinely still-outstanding balance from being paid online, but it IS
  // worth surfacing so the customer doesn't pay twice while a report is
  // still being checked.
  const pendingBankUpi = await prisma.payment.findFirst({
    where: { invoiceId: invoice.id, paymentSource: 'bank_upi', verificationStatus: 'pending' },
  });
  if (pendingBankUpi) {
    res
      .status(200)
      .send(
        renderStatusPage(
          'Payment under review',
          "We're verifying a payment reported for this order. If you believe you still owe a balance, please contact us before paying again."
        )
      );
    return;
  }

  if (invoice.razorpayPaymentLinkId && invoice.paymentLinkUrl) {
    res.redirect(302, invoice.paymentLinkUrl);
    return;
  }

  res
    .status(200)
    .send(renderStatusPage('Payment temporarily unavailable', 'Please contact us to complete your payment.'));
};
