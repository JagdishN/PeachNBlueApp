import prisma from '../prisma/client';
import { generateInvoice } from './invoiceService';
import { sendNotification } from './notificationService';
import { MSG91_TEMPLATES } from '../constants/msg91Templates';

// CLAUDE.md "Per-flat discounts — RESOLVED": both triggers (discount
// applied, amount manually revised) call this one shared function, which
// itself delegates the actual PDF/payment-link work to invoiceService's
// generateInvoice — that's the single implementation CLAUDE.md asks for,
// not two parallel ones. generateInvoice is what detects "was there a
// prior invoice" and handles the cancel-old-link + version bump.
export const reissueInvoice = async (orderId: string): Promise<void> => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      orderNumber: true,
      customer: {
        select: {
          id: true,
          fullName: true,
          phoneNumber: true,
          whatsappNumber: true,
          branch: { select: { whatsappNumber: true } },
        },
      },
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const invoice = await generateInvoice(orderId);

  // paymentLinkUrl is null for monthly-billing orders (see invoiceService.ts)
  // — this reissue path still runs for them (a discount change still affects
  // what they owe via the ledger), just with no live link to reference. The
  // approved invoice_reissued template has no body-variable branch for "no
  // link, settled via statement" the way the old placeholder version did, so
  // this notification is skipped entirely for a monthly-billing reissue; the
  // reissued invoice/ledger state itself is still updated above regardless.
  if (!invoice.paymentLinkUrl) {
    return;
  }

  // CORRECTED (2026-09-03): the approved template turned out to have no URL
  // button component at all — a real pulled definition (see
  // /msg91-templates/invoiceReissued.json) showed only body_1/2/3, no
  // button_1, contradicting the client's original approved-templates doc.
  // Confirmed directly with the client ("I think I have not added
  // buttons"). Per explicit decision, the payment link is now appended as
  // plain text onto the {{3}} (amount) body variable instead of a button —
  // WhatsApp auto-links a plain-text URL in body content, no button
  // component or template resubmission required. The approved template also
  // has no document-header component (unlike the old placeholder version)
  // — the reissued PDF is generated/stored either way, just not attached to
  // this WhatsApp message.
  await sendNotification(
    order.customer,
    'invoice_reissued',
    {
      name: MSG91_TEMPLATES.invoiceReissued.name,
      language: MSG91_TEMPLATES.invoiceReissued.language,
      bodyVariables: [
        order.customer.fullName,
        order.orderNumber,
        `${invoice.amount}. Pay online: ${invoice.paymentLinkUrl}`,
      ],
    },
    orderId
  );
};

// Used by the discount-change path (customerController.ts::updateDiscountHandler)
// — a discount edit can affect several open orders for the same customer at
// once. CLAUDE.md scopes this to "every one of this customer's orders that
// isn't yet delivered/paid" (internal_status !== delivered AND
// payment_status !== paid); sequential (not Promise.all) to avoid bursting
// Razorpay's rate limits when a customer has several open orders.
export const reissueAllOpenInvoicesForCustomer = async (customerId: string): Promise<void> => {
  const openOrders = await prisma.order.findMany({
    where: { customerId, internalStatus: { not: 'delivered' }, paymentStatus: { not: 'paid' } },
    select: { id: true },
  });

  for (const order of openOrders) {
    await reissueInvoice(order.id);
  }
};
