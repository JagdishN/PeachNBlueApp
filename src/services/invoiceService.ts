import crypto from 'crypto';
import prisma from '../prisma/client';
import { createPaymentLink, cancelPaymentLink } from '../lib/razorpayClient';
import { uploadInvoicePdf } from '../lib/supabaseStorage';
import { renderInvoicePdf } from './invoicePdfService';

// Matches orderService.ts's generateOrderNumber() style (PB-XXXXXXXX).
const generateInvoiceNumber = (): string => `PB-INV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

// Sourced from the same garments-seed-data-v2.json businessInfo.turnaroundTimeHours
// that orderService.ts's pickup_confirmation message text already uses.
const TURNAROUND_LABEL = '24–48';

export interface GeneratedInvoice {
  id: string;
  invoiceNumber: string;
  pdfUrl: string | null;
  paymentLinkUrl: string | null;
  amount: number;
  wasReissue: boolean;
}

interface OrderItemLine {
  itemName: string;
  quantity: number | null;
  unitPrice: unknown;
  weightKg: unknown;
  pricePerKg: unknown;
  lineTotal: unknown;
}

const formatQuantityLabel = (item: OrderItemLine): string =>
  item.weightKg != null ? `${item.weightKg} kg` : `${item.quantity}`;

const formatUnitPriceLabel = (item: OrderItemLine): string =>
  item.weightKg != null ? `₹${item.pricePerKg}/kg` : `₹${item.unitPrice}`;

// Shared core for BOTH the fresh-invoice-at-pickup path and the reissue
// path (CLAUDE.md: discount change and amount revision "should call the
// same shared invoice-reissue function, not two separate implementations").
// The two paths differ only in whether a prior Invoice row exists: if one
// does, its payment link gets a best-effort cancel and the version/invoice
// number bump; if not, this is just the order's first invoice (version 1).
// Idempotent by design — safe to call again after a partial failure, and
// safe to call on an order that already has a fully-formed invoice (that's
// exactly what a reissue is).
export const generateInvoice = async (orderId: string): Promise<GeneratedInvoice> => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { customer: { include: { branch: true } }, orderItems: true, invoice: true },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const discountPercent = Number(order.customer.discountPercent ?? 0);
  const subtotal = Number(order.finalAmount);
  const amount = Math.round(subtotal * (1 - discountPercent / 100) * 100) / 100;

  const paymentLink = await createPaymentLink({
    amount,
    orderNumber: order.orderNumber,
    orderId: order.id,
    customerName: order.customer.fullName,
    customerPhone: order.customer.phoneNumber,
  });

  const previousInvoice = order.invoice;
  if (previousInvoice?.razorpayPaymentLinkId) {
    // Best-effort — CLAUDE.md: the part that actually prevents a
    // double-payment/stale-amount risk. cancelPaymentLink swallows its own
    // failures, so this never blocks the new link from going out.
    await cancelPaymentLink(previousInvoice.razorpayPaymentLinkId);
  }

  const version = (previousInvoice?.version ?? 0) + 1;
  const baseInvoiceNumber = previousInvoice?.invoiceNumber.replace(/-R\d+$/, '') ?? generateInvoiceNumber();
  const invoiceNumber = version > 1 ? `${baseInvoiceNumber}-R${version}` : baseInvoiceNumber;

  const pdfBuffer = await renderInvoicePdf({
    invoiceNumber,
    orderNumber: order.orderNumber,
    pickupDate: order.pickupDate,
    customerName: order.customer.fullName,
    locationLabel: order.customer.locationLabel,
    branchName: order.customer.branch.branchName,
    items: order.orderItems.map((item) => ({
      itemName: item.itemName,
      quantityLabel: formatQuantityLabel(item),
      unitPriceLabel: formatUnitPriceLabel(item),
      lineTotal: Number(item.lineTotal),
    })),
    subtotal,
    discountPercent,
    amount,
    paymentLinkUrl: paymentLink.shortUrl,
    turnaroundLabel: TURNAROUND_LABEL,
  });

  const pdfUrl = await uploadInvoicePdf(`${invoiceNumber}.pdf`, pdfBuffer);

  const invoiceData = {
    invoiceNumber,
    pdfUrl,
    razorpayPaymentLinkId: paymentLink.id,
    paymentLinkUrl: paymentLink.shortUrl,
    paymentLinkStatus: 'created',
    amount,
    version,
  };

  const invoice = await prisma.invoice.upsert({
    where: { orderId: order.id },
    create: { orderId: order.id, ...invoiceData },
    update: invoiceData,
  });

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    pdfUrl: invoice.pdfUrl,
    paymentLinkUrl: invoice.paymentLinkUrl,
    amount,
    wasReissue: previousInvoice != null,
  };
};
