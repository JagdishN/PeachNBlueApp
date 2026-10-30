import crypto from 'crypto';
import prisma from '../prisma/client';
import { createPaymentLink, cancelPaymentLink } from '../lib/razorpayClient';
import { uploadInvoicePdf } from '../lib/supabaseStorage';
import { renderInvoicePdf } from './invoicePdfService';
import { calculatePayableAmount } from '../utils/pricing';
import { getTurnaroundText } from '../utils/turnaround';
import { ensurePaymentToken } from './payTokenService';
import { getCustomerOutstandingSummary } from './outstandingService';

// Matches orderService.ts's generateOrderNumber() style (PB-XXXXXXXX).
const generateInvoiceNumber = (): string => `PB-INV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

export interface GeneratedInvoice {
  id: string;
  invoiceNumber: string;
  pdfUrl: string | null;
  paymentLinkUrl: string | null;
  amount: number;
  // Outstanding-dues rework — 0 for a reissue (never re-snapshotted) or
  // when the customer has no other outstanding invoices.
  previousDuesTotal: number;
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

// "Rs." not "₹" — see invoicePdfService.tsx's formatInr for why (Helvetica,
// the only font @react-pdf/renderer uses here, has no ₹ glyph).
const formatUnitPriceLabel = (item: OrderItemLine): string =>
  item.weightKg != null ? `Rs. ${item.pricePerKg}/kg` : `Rs. ${item.unitPrice}`;

// serviceType is deliberately a free-form string, not a hard enum (CLAUDE.md
// "Admin can add new service types") — a fixed label map would silently
// break for a genuinely new admin-added type, so this just title-cases the
// raw value as a generic fallback, same reasoning mobile's serviceTag.ts
// already uses for an unrecognized type.
const formatServiceTypeLabel = (serviceType: string): string =>
  serviceType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

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
    include: {
      customer: { include: { branch: true } },
      // Real invoice-design gap found 2026-09-03 (a real reference PDF
      // sample the client built showed a "Service" column per line item —
      // CLAUDE.md's own "Major pricing model update" point 5 already
      // documents that the same garment name can legitimately appear at
      // different prices across service tiers, so showing which tier a
      // line was billed at removes real ambiguity on the printed invoice).
      // OrderItem itself has no serviceType column (it's on the linked
      // GarmentCatalogue row), so this needs the join.
      orderItems: { include: { garment: { select: { serviceType: true } } } },
      invoice: true,
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  // CLAUDE.md "Monthly billing + discount: now live" — a discount only
  // applies when BOTH discountEnabled is true AND discountPercent > 0;
  // toggling discountEnabled off must not lose the stored percentage, so
  // this is a runtime gate in calculatePayableAmount, not a change to the
  // stored value. Shared with orderService.ts's ledger charge so the two
  // never disagree on what the customer actually owes.
  const discountPercent = order.customer.discountEnabled ? Number(order.customer.discountPercent ?? 0) : 0;
  const subtotal = Number(order.finalAmount);
  const discountedSubtotal = calculatePayableAmount(subtotal, order.customer);

  // CLAUDE.md "Bag-replacement ₹350 charge": wired to the invoice from the
  // customer's first actual replacement onward (the free initial bag
  // issuance was never a charge to begin with, so there's nothing to
  // exclude) — a flat add-on, not discounted, since it isn't a laundry
  // service. Only charges tied to THIS order via orderId are included;
  // untied reports (customer calls in separately, no order context) aren't
  // attached to any invoice yet — see CLAUDE.md for why that's still open.
  const bagCharges = await prisma.additionalCharge.findMany({
    where: { orderId: order.id, chargeType: 'bag_replacement' },
  });
  const additionalChargesTotal = bagCharges.reduce((sum, charge) => sum + Number(charge.amount), 0);

  const amount = discountedSubtotal + additionalChargesTotal;

  // Outstanding-dues rework, section 3 — "previous dues" are OTHER
  // invoices' outstanding balances, shown as a brought-forward receivable
  // on a genuinely NEW invoice only (this order's first version — a
  // reissue of the SAME invoice isn't a new sale, it's revising this one,
  // so it doesn't re-snapshot). Never added into `amount`/`subtotal`
  // above — the taxable sales value of THIS invoice is completely
  // unaffected ("the new invoice's sales value must remain [current order
  // amount]... not added as a new sale").
  const previousInvoice = order.invoice;
  let previousDuesRows: { invoiceId: string; outstandingPaise: bigint }[] = [];
  let previousDuesTotal = 0;
  if (!previousInvoice) {
    const outstandingSummary = await getCustomerOutstandingSummary(order.customerId);
    const owedElsewhere = outstandingSummary.invoices.filter((row) => row.outstanding > 0);
    previousDuesTotal = owedElsewhere.reduce((sum, row) => sum + row.outstanding, 0);
    previousDuesRows = owedElsewhere.map((row) => ({
      invoiceId: row.invoiceId,
      outstandingPaise: BigInt(Math.round(row.outstanding * 100)),
    }));
  }

  // Payment-safety review section 10: "An invoice revision must not erase
  // payment history or accidentally create an active link for an incorrect
  // balance." The pre-existing behavior always created a fresh Razorpay
  // link for the FULL new `amount`, even if some of it had already been
  // collected (e.g. a staff cash payment landed before a later discount/
  // amount-revision triggered this reissue) — a customer could then be
  // asked to pay the whole amount again via the link. Netting out already-
  // verified payments here fixes that without restructuring this already
  // live-verified flow through the newer, more invasive
  // paymentLinkLifecycle.ts (deliberately NOT done — see CLAUDE.md/the
  // payment-safety delivery report for why that was scoped out of this
  // pass). The invoice/PDF's displayed `amount` stays the full total
  // (unchanged) — only the LINK's requested amount is reduced.
  let linkAmount = amount;
  if (previousInvoice) {
    const alreadyAllocated = await prisma.payment.aggregate({
      where: { invoiceId: previousInvoice.id, verificationStatus: 'verified', status: { not: 'refunded' } },
      _sum: { allocatedPaise: true },
    });
    const allocatedSoFar = Number(alreadyAllocated?._sum?.allocatedPaise ?? 0n) / 100;
    linkAmount = Math.max(0, Math.round((amount - allocatedSoFar) * 100) / 100);
  }

  // Monthly-billing customers settle via the ledger, not a per-order payment
  // (CLAUDE.md "Payment marking" / orderService.ts's recordPayment already
  // rejects a manual payment attempt for them) — a real, payable Razorpay
  // link contradicted that even before the webhook existed, since paying it
  // would have no corresponding "mark paid" path. Decided (2026-08-09,
  // confirmed via AskUserQuestion) to fix this at the source rather than
  // teach the webhook to reconcile a payment that shouldn't be possible:
  // skip real payment-link creation entirely for these orders. The PDF/QR
  // invoice still goes out — renderInvoicePdf already handles a null
  // paymentLinkUrl by omitting the QR/link — just with no live payable link.
  const isMonthlyBilling = order.billingMode === 'monthly_billing';

  // No live link needed when a prior partial/full payment already covers
  // the (possibly revised) amount in full — same reasoning as the
  // monthly-billing case just above: don't ask the customer to pay again
  // for money already collected.
  const paymentLink =
    isMonthlyBilling || linkAmount <= 0
      ? null
      : await createPaymentLink({
          amount: linkAmount,
          orderNumber: order.orderNumber,
          orderId: order.id,
          customerName: order.customer.fullName,
          customerPhone: order.customer.phoneNumber,
        });

  if (previousInvoice?.razorpayPaymentLinkId) {
    // Best-effort — CLAUDE.md: the part that actually prevents a
    // double-payment/stale-amount risk. cancelPaymentLink swallows its own
    // failures, so this never blocks the new link from going out. Runs
    // unconditionally (even for a now-monthly-billing order) to clean up a
    // legacy real link from before the fix above existed.
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
      serviceTypeLabel: formatServiceTypeLabel(item.garment.serviceType),
      quantityLabel: formatQuantityLabel(item),
      unitPriceLabel: formatUnitPriceLabel(item),
      lineTotal: Number(item.lineTotal),
    })),
    subtotal,
    discountPercent,
    additionalChargesTotal,
    amount,
    previousDuesTotal,
    paymentLinkUrl: paymentLink?.shortUrl ?? null,
    turnaroundText: getTurnaroundText(order.orderItems.map((item) => item.garment.serviceType)),
  });

  const pdfUrl = await uploadInvoicePdf(`${invoiceNumber}.pdf`, pdfBuffer);

  // 'paid' (not null) when there's no live link specifically because a
  // prior payment already covers the revised amount in full — distinct
  // from the monthly-billing case, which never had a link at all.
  const paymentLinkStatus = paymentLink ? 'created' : !isMonthlyBilling && previousInvoice ? 'paid' : null;

  // Outstanding-dues rework (2026-10-30, client decision) — due date =
  // invoice date + a fixed 4-day grace period, set ONCE at this order's
  // first invoice and preserved across every later reissue (a discount
  // change or amount revision shouldn't push a customer's due date
  // forward just because the admin touched the amount). previousInvoice
  // here is version N-1 of the SAME order's invoice, not a different
  // order — its dueDate, if already set, is the one that sticks.
  const DUE_DATE_GRACE_DAYS = 4;
  const dueDate =
    previousInvoice?.dueDate ??
    (() => {
      const d = new Date();
      d.setDate(d.getDate() + DUE_DATE_GRACE_DAYS);
      return d;
    })();

  const invoiceData = {
    invoiceNumber,
    pdfUrl,
    razorpayPaymentLinkId: paymentLink?.id ?? null,
    paymentLinkUrl: paymentLink?.shortUrl ?? null,
    paymentLinkStatus,
    amount,
    dueDate,
    version,
  };

  const invoice = await prisma.invoice.upsert({
    where: { orderId: order.id },
    create: { orderId: order.id, ...invoiceData },
    update: invoiceData,
  });

  // Payment-safety review section 5 — assigns a controlled-URL token once
  // (stable across reissues, see payTokenService.ts). Not yet surfaced in
  // any WhatsApp message's button (see that file's own caveat on why) —
  // generated here regardless so GET /pay/:token has something real to
  // resolve against as soon as it IS wired in, rather than that being a
  // second deploy later.
  await ensurePaymentToken(invoice.id);

  // Outstanding-dues rework, section 3 — the immutable snapshot, written
  // once (only on this order's genuinely fresh first invoice, per the
  // !previousInvoice gate above). Never rewritten on a later reissue of
  // THIS invoice, and never touched when those OTHER invoices' balances
  // subsequently change.
  if (previousDuesRows.length > 0) {
    await prisma.invoicePreviousDuesLine.createMany({
      data: previousDuesRows.map((row) => ({
        invoiceId: invoice.id,
        priorInvoiceId: row.invoiceId,
        outstandingAtSnapshotPaise: row.outstandingPaise,
      })),
    });
  }

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    pdfUrl: invoice.pdfUrl,
    paymentLinkUrl: invoice.paymentLinkUrl,
    amount,
    previousDuesTotal,
    wasReissue: previousInvoice != null,
  };
};
