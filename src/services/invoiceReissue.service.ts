import prisma from '../prisma/client';
import { generateInvoice } from './invoiceService';
import { sendNotification } from './notificationService';

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
      customer: { select: { id: true, phoneNumber: true, whatsappNumber: true } },
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const invoice = await generateInvoice(orderId);

  await sendNotification(
    order.customer,
    'invoice_reissued',
    `Your Peach & Blue order ${order.orderNumber}'s invoice has been updated. Amount to be paid: ₹${invoice.amount}. New payment link: ${invoice.paymentLinkUrl}`,
    orderId,
    invoice.pdfUrl ?? undefined
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
