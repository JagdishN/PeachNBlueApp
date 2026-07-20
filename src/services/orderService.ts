import crypto from 'crypto';
import { OrderInternalStatus } from '@prisma/client';
import prisma from '../prisma/client';
import { sendNotification } from './notificationService';
import { recordCharge } from './ledgerService';
import { sendToUser, sendToUsers } from './pushService';

// Note: ledger-charge / Razorpay QR / invoice PDF side effects on delivery
// are intentionally NOT wired here yet — those land when the backend's
// Razorpay/ledger/PDF work (still pending) is built. updateStatus today
// only transitions internal_status and logs history.

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

interface CreateOrderItemInput {
  garmentId: string;
  quantity: number;
  // Required when the garment has a priceMax (a price-range item, e.g.
  // Designer Dress ₹80–₹150) — staff pick the final price at pickup.
  // Ignored for fixed-price garments, which always use garment.price.
  chosenPrice?: number;
}

interface CreateOrderInput {
  createdById: string;
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
    }

    const lineTotal = unitPrice * item.quantity;
    return {
      garmentId: garment.id,
      itemName: garment.itemName,
      quantity: item.quantity,
      unitPrice,
      lineTotal,
    };
  });

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
      include: { orderItems: true, customer: true },
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

  return order;
};

interface ListOrdersFilter {
  branchId?: string;
  date?: Date;
}

export const listOrders = async ({ branchId, date }: ListOrdersFilter) => {
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
    include: { customer: true, orderItems: true },
    orderBy: { createdAt: 'desc' },
  });
};

export const getOrder = async (orderId: string) => {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: { customer: true, orderItems: true, amountRevisions: true, statusHistory: true },
  });
};

export const updateStatus = async (orderId: string, newStatus: OrderInternalStatus, changedById: string) => {
  if (!ORDER_STATUS_SEQUENCE.includes(newStatus) && newStatus !== 'cancelled') {
    const err = new Error(`Invalid status: ${newStatus}`);
    (err as any).status = 400;
    throw err;
  }

  const order = await prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id: orderId },
      data: { internalStatus: newStatus },
      include: { customer: true, orderItems: true },
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
