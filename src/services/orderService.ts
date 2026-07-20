import crypto from 'crypto';
import { OrderInternalStatus, UserRole } from '../types/enums';
import prisma from '../prisma/client';
import { sendNotification } from './notificationService';
import { recordCharge } from './ledgerService';
import { sendToUser, sendToUsers } from './pushService';
import { customerSelectForRole } from '../utils/roleAwareSelect';
import { generateInvoice } from './invoiceService';
import { reissueInvoice } from './invoiceReissue.service';

// Note: ledger-charge side effects on delivery are intentionally NOT wired
// here yet — that lands when the backend's Razorpay/ledger delivery-time
// work (still pending) is built. updateStatus today only transitions
// internal_status and logs history. Invoice PDF/payment-link generation IS
// wired, but at pickup (createOrder) and reissue (reviseAmount) — see those
// functions below — not at delivery.

const ORDER_STATUS_SEQUENCE: OrderInternalStatus[] = [
  'picked_up',
  'washing',
  'ironing',
  'ready',
  'out_for_delivery',
  'delivered',
];

const generateOrderNumber = (): string => {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `PB-${suffix}`;
};

// Sourced from garments-seed-data-v2.json businessInfo.laundryMinimumKg —
// the client's rate card states "Minimum 5 Kg applicable for laundry
// services" for the per-KG tier. Order-level, not per-item: see CLAUDE.md
// "Major pricing model update".
const LAUNDRY_MINIMUM_KG = 5;

interface CreateOrderItemInput {
  garmentId: string;
  // Per-piece garments (pricingUnit "per_piece").
  quantity?: number;
  // Per-KG garments (pricingUnit "per_kg") — weight staff measured at pickup.
  weightKg?: number;
  // Required when the garment has a priceMax (a price-range item, e.g.
  // Designer Dress ₹80–₹150) or isStartingPrice (a floor price, e.g. Sofa
  // Cover) — staff pick/enter the final price at pickup. Ignored for
  // fixed-price garments, which always use garment.price.
  chosenPrice?: number;
}

interface CreateOrderInput {
  createdById: string;
  createdByRole: UserRole;
  staffId?: string;
  branchId: string;
  customerName: string;
  customerPhoneNumber: string;
  locationLabel: string;
  pickupDate: Date;
  items: CreateOrderItemInput[];
}

export const createOrder = async (input: CreateOrderInput) => {
  if (input.items.length === 0) {
    const err = new Error('Order must include at least one garment item.');
    (err as any).status = 400;
    throw err;
  }

  const garments = await prisma.garmentCatalogue.findMany({
    where: { id: { in: input.items.map((item) => item.garmentId) } },
  });

  const garmentById = new Map(garments.map((g) => [g.id, g]));

  const itemsToCreate = input.items.map((item) => {
    const garment = garmentById.get(item.garmentId);
    if (!garment) {
      const err = new Error(`Garment ${item.garmentId} not found.`);
      (err as any).status = 400;
      throw err;
    }

    if (garment.pricingUnit === 'per_kg') {
      if (item.weightKg === undefined || item.weightKg <= 0) {
        const err = new Error(`${garment.itemName} is billed per kg; weightKg (greater than 0) is required.`);
        (err as any).status = 400;
        throw err;
      }

      const pricePerKg = Number(garment.price);
      return {
        garmentId: garment.id,
        itemName: garment.itemName,
        quantity: null,
        unitPrice: null,
        weightKg: item.weightKg,
        pricePerKg,
        // May be scaled up below to honor the order-level 5kg minimum.
        lineTotal: item.weightKg * pricePerKg,
      };
    }

    const priceMax = garment.priceMax !== null ? Number(garment.priceMax) : null;
    let unitPrice = Number(garment.price);

    if (priceMax !== null) {
      if (item.chosenPrice === undefined) {
        const err = new Error(
          `${garment.itemName} is priced as a range (₹${garment.price}–₹${garment.priceMax}); chosenPrice is required.`
        );
        (err as any).status = 400;
        throw err;
      }
      if (item.chosenPrice < unitPrice || item.chosenPrice > priceMax) {
        const err = new Error(
          `chosenPrice for ${garment.itemName} must be between ₹${garment.price} and ₹${garment.priceMax}.`
        );
        (err as any).status = 400;
        throw err;
      }
      unitPrice = item.chosenPrice;
    } else if (garment.isStartingPrice) {
      if (item.chosenPrice === undefined) {
        const err = new Error(`${garment.itemName} is priced from ₹${garment.price} onwards; chosenPrice is required.`);
        (err as any).status = 400;
        throw err;
      }
      if (item.chosenPrice < unitPrice) {
        const err = new Error(`chosenPrice for ${garment.itemName} must be at least ₹${garment.price}.`);
        (err as any).status = 400;
        throw err;
      }
      unitPrice = item.chosenPrice;
    }

    if (item.quantity === undefined || item.quantity <= 0) {
      const err = new Error(`${garment.itemName} requires a quantity (greater than 0).`);
      (err as any).status = 400;
      throw err;
    }

    return {
      garmentId: garment.id,
      itemName: garment.itemName,
      quantity: item.quantity,
      unitPrice,
      weightKg: null,
      pricePerKg: null,
      lineTotal: unitPrice * item.quantity,
    };
  });

  // Order-level 5kg minimum charge on per-KG lines (CLAUDE.md "Major pricing
  // model update"). Computed here rather than stored on the order, matching
  // this codebase's derive-don't-duplicate convention (see internalStatus
  // vs the customer-facing status label). When mixed per-KG items fall
  // short of the minimum, each line is scaled up proportionally so
  // per-line totals still sum to the order total — needed for the invoice
  // to itemize correctly rather than showing an unexplained top-up.
  const perKgItems = itemsToCreate.filter((item) => item.weightKg !== null);
  const totalPerKgWeight = perKgItems.reduce((sum, item) => sum + item.weightKg!, 0);

  if (perKgItems.length > 0 && totalPerKgWeight < LAUNDRY_MINIMUM_KG) {
    const scaleFactor = LAUNDRY_MINIMUM_KG / totalPerKgWeight;
    for (const item of perKgItems) {
      item.lineTotal = Math.round(item.lineTotal * scaleFactor * 100) / 100;
    }
  }

  const estimatedAmount = itemsToCreate.reduce((sum, item) => sum + item.lineTotal, 0);

  const order = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.upsert({
      where: {
        phoneNumber_branchId_locationLabel: {
          phoneNumber: input.customerPhoneNumber,
          branchId: input.branchId,
          locationLabel: input.locationLabel,
        },
      },
      update: { fullName: input.customerName },
      create: {
        fullName: input.customerName,
        phoneNumber: input.customerPhoneNumber,
        branchId: input.branchId,
        locationLabel: input.locationLabel,
      },
    });

    return tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        customerId: customer.id,
        createdById: input.createdById,
        staffId: input.staffId ?? input.createdById,
        internalStatus: 'picked_up',
        pickupDate: input.pickupDate,
        estimatedAmount,
        finalAmount: estimatedAmount,
        orderItems: { create: itemsToCreate },
        statusHistory: { create: { status: 'picked_up', changedById: input.createdById } },
      },
      include: { orderItems: true, customer: { select: customerSelectForRole(input.createdByRole) } },
    });
  });

  // Pickup confirmation — WhatsApp + SMS, always both (CLAUDE.md). Turnaround
  // time (24–48 hours, businessInfo.turnaroundTimeHours in the garment seed
  // data) is informational here only; it's not repeated on delivery.
  await sendNotification(
    order.customer,
    'pickup_confirmation',
    `Your Peach & Blue order ${order.orderNumber} has been picked up. Estimated amount: ₹${estimatedAmount}. Turnaround time is typically 24–48 hours. We'll notify you before delivery if the amount changes.`,
    order.id
  );

  // "New order assigned" push — only fires when an admin logs an order on
  // behalf of a specific staff member other than themselves; a staff member
  // logging their own pickup doesn't need to be notified of it.
  if (input.staffId && input.staffId !== input.createdById) {
    await sendToUser(input.staffId, 'New Order Assigned', `Order #${order.orderNumber} at ${input.locationLabel}`, {
      orderId: order.id,
    });
  }

  // Invoice PDF + Razorpay payment link (CLAUDE.md: instant at pickup, not
  // delivery) — deliberately NOT awaited. PDF generation must run as a
  // background job, never inline with the request that completes an order
  // (CLAUDE.md tech-stack decision), so the staff member's app isn't left
  // waiting on PDF render + Razorpay + storage upload. This is the first
  // genuinely fire-and-forget side effect in this file; the two-message
  // pattern is deliberate — today's pickup_confirmation text above still
  // fires instantly, and this follow-up lands moments later once ready.
  generateInvoice(order.id)
    .then((invoice) =>
      sendNotification(
        order.customer,
        'pickup_confirmation',
        `Here is your invoice for order ${order.orderNumber}. Amount: ₹${invoice.amount}. Pay online: ${invoice.paymentLinkUrl}`,
        order.id,
        invoice.pdfUrl ?? undefined
      )
    )
    .catch((err) => console.error(`Invoice generation failed for order ${order.id}:`, err));

  return order;
};

interface ListOrdersFilter {
  branchId?: string;
  date?: Date;
  role: UserRole;
}

export const listOrders = async ({ branchId, date, role }: ListOrdersFilter) => {
  const pickupDateFilter = date
    ? {
        gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
        lt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1),
      }
    : undefined;

  return prisma.order.findMany({
    where: {
      ...(branchId ? { customer: { branchId } } : {}),
      ...(pickupDateFilter ? { pickupDate: pickupDateFilter } : {}),
    },
    include: { customer: { select: customerSelectForRole(role) }, orderItems: true },
    orderBy: { createdAt: 'desc' },
  });
};

export const getOrder = async (orderId: string, role: UserRole) => {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: { select: customerSelectForRole(role) },
      orderItems: true,
      amountRevisions: true,
      statusHistory: true,
    },
  });
};

export const updateStatus = async (
  orderId: string,
  newStatus: OrderInternalStatus,
  changedById: string,
  role: UserRole
) => {
  if (!ORDER_STATUS_SEQUENCE.includes(newStatus) && newStatus !== 'cancelled') {
    const err = new Error(`Invalid status: ${newStatus}`);
    (err as any).status = 400;
    throw err;
  }

  const order = await prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id: orderId },
      data: { internalStatus: newStatus },
      include: { customer: { select: customerSelectForRole(role) }, orderItems: true },
    });

    await tx.orderStatusHistory.create({
      data: { orderId, status: newStatus, changedById },
    });

    return updated;
  });

  // Monthly-billing customers accrue a running balance; daily customers pay
  // at delivery directly (no Razorpay/cash-payment recording exists yet —
  // that lands with the deferred Razorpay work), so nothing to charge here.
  if (newStatus === 'delivered' && order.customer.billingMode === 'monthly_billing') {
    await recordCharge(order.customer.id, order.id, Number(order.finalAmount), `Order ${order.orderNumber}`);
  }

  return order;
};

export const reviseAmount = async (
  orderId: string,
  newAmount: number,
  reason: string,
  revisedById: string
) => {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { customer: true } });

  if (!order) {
    const err = new Error('Order not found.');
    (err as any).status = 404;
    throw err;
  }

  if (order.internalStatus === 'delivered') {
    const err = new Error('Cannot revise amount after delivery.');
    (err as any).status = 400;
    throw err;
  }

  const oldAmount = order.finalAmount;

  const updatedOrder = await prisma.$transaction(async (tx) => {
    await tx.orderAmountRevision.create({
      data: { orderId, oldAmount, newAmount, reason, revisedById },
    });

    return tx.order.update({
      where: { id: orderId },
      data: { finalAmount: newAmount, amountWasRevised: true },
      include: { customer: true },
    });
  });

  // Mandatory reason IS the customer-facing message — CLAUDE.md non-negotiable.
  await sendNotification(
    updatedOrder.customer,
    'amount_revision',
    `Your Peach & Blue order ${order.orderNumber}'s amount was revised to ₹${newAmount}. Reason: ${reason}`,
    orderId
  );

  // CLAUDE.md "Per-flat discounts — RESOLVED": an amount revision must
  // reissue the invoice (new PDF + new payment link, old link cancelled),
  // not just send the text notice above — otherwise the customer could
  // still pay the stale pre-revision amount via the original link. Awaited:
  // this whole flow is already a synchronous admin action, and the admin
  // revising the amount should see a reissue failure, not have it silently
  // swallowed in the background.
  await reissueInvoice(orderId);

  // "Amount revision needing attention" push — flags the change to broader
  // admin oversight (unscoped admins, plus any admin scoped to this order's
  // branch), excluding whoever just made the revision themselves.
  const relevantAdmins = await prisma.user.findMany({
    where: {
      role: 'admin',
      id: { not: revisedById },
      OR: [{ branchId: null }, { branchId: updatedOrder.customer.branchId }],
    },
  });

  if (relevantAdmins.length > 0) {
    await sendToUsers(
      relevantAdmins.map((admin) => admin.id),
      'Amount Revised',
      `Order ${order.orderNumber} amount revised to ₹${newAmount}`,
      { orderId }
    );
  }

  return updatedOrder;
};
