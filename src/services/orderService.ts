import crypto from 'crypto';
import { OrderInternalStatus, UserRole, PaymentMethod } from '../types/enums';
import prisma from '../prisma/client';
import { sendNotification } from './notificationService';
import { recordCharge } from './ledgerService';
import { sendToUser, sendToUsers } from './pushService';
import { customerSelectForRole } from '../utils/roleAwareSelect';
import { generateInvoice } from './invoiceService';
import { reissueInvoice } from './invoiceReissue.service';
import { calculatePayableAmount } from '../utils/pricing';

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
    // Phone number is globally unique per customer now (CLAUDE.md "Customer
    // phone number uniqueness — RESOLVED") — match on phoneNumber alone. On
    // a match, only fullName is refreshed; branchId/locationLabel are the
    // customer's already-established record and are never silently
    // overwritten by whatever this particular order submission happened to
    // carry (the real enforcement point for a genuine branch/location
    // conflict is createCustomerHandler, which this order's customer was
    // already resolved through during the app's search/create step).
    const customer = await tx.customer.upsert({
      where: { phoneNumber: input.customerPhoneNumber },
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
        // Snapshot, not a live reference (CLAUDE.md "Monthly billing
        // retroactivity — RESOLVED") — a later change to the customer's
        // billingMode must not retroactively change how this order settles.
        billingMode: customer.billingMode,
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
  // CLAUDE.md "Staff-scoped order visibility": each staff member sees only
  // orders assigned to them, in addition to the existing branch scope.
  // Admin visibility is unchanged regardless of whether this is passed.
  staffId?: string;
}

export const listOrders = async ({ branchId, date, role, staffId }: ListOrdersFilter) => {
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
      ...(role === 'staff' && staffId ? { staffId } : {}),
    },
    include: { customer: { select: customerSelectForRole(role) }, orderItems: true },
    orderBy: { createdAt: 'desc' },
  });
};

interface OrderScope {
  // Restricts to a single branch — applied for staff always, and for a
  // branch-scoped admin (mirrors listOrdersHandler's effectiveBranchId).
  branchId?: string;
  // Restricts to a single assigned staff member — CLAUDE.md "Staff-scoped
  // order visibility". Only meaningful when role === 'staff'.
  staffId?: string;
}

export const getOrder = async (orderId: string, role: UserRole, scope: OrderScope = {}) => {
  // findFirst (not findUnique) so branch/staff scoping applies at the query
  // level, not as a post-fetch check — an out-of-scope order comes back as
  // null, indistinguishable from "doesn't exist", rather than leaking that
  // an order with this id exists in someone else's branch.
  return prisma.order.findFirst({
    where: {
      id: orderId,
      ...(scope.branchId ? { customer: { branchId: scope.branchId } } : {}),
      ...(scope.staffId ? { staffId: scope.staffId } : {}),
    },
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

  // CLAUDE.md "Staff-scoped order visibility" (write side): a staff member
  // may only update an order they're actually assigned to — previously any
  // staff in the branch could update any order in that branch. changedById
  // IS the requesting staff member's own id here (there's no separate
  // "acting staffId" concept for a status update, unlike createOrder's
  // admin-assigns-to-staff case), so it's compared directly against the
  // order's assigned staffId.
  if (role === 'staff') {
    const existing = await prisma.order.findUnique({ where: { id: orderId }, select: { staffId: true } });

    if (!existing) {
      const err = new Error('Order not found.');
      (err as any).status = 404;
      throw err;
    }

    if (existing.staffId !== changedById) {
      const err = new Error('Forbidden: you can only update orders assigned to you.');
      (err as any).status = 403;
      throw err;
    }
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
  // that lands with the deferred Razorpay work). The charge must match what
  // the customer's invoice actually says (a discount reduces both or
  // neither) — so this fetches discountEnabled/discountPercent directly
  // rather than reading them off `order.customer`, which is role-scoped
  // (customerSelectForRole) and has those fields excluded entirely when a
  // staff member is the one marking the order delivered.
  //
  // Reads order.billingMode (this order's own snapshot from creation time),
  // NOT order.customer.billingMode (the customer's current, possibly since-
  // changed setting) — CLAUDE.md "Monthly billing retroactivity — RESOLVED":
  // flipping a customer's billing mode must only affect orders created
  // after the flip, not ones already in flight.
  if (newStatus === 'delivered' && order.billingMode === 'monthly_billing') {
    const discountFields = await prisma.customer.findUnique({
      where: { id: order.customer.id },
      select: { discountEnabled: true, discountPercent: true },
    });
    const payableAmount = calculatePayableAmount(
      Number(order.finalAmount),
      discountFields ?? { discountEnabled: false, discountPercent: 0 }
    );
    await recordCharge(order.customer.id, order.id, payableAmount, `Order ${order.orderNumber}`);
  }

  return order;
};

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'upi', 'net_banking', 'credit_card'];

// CLAUDE.md "Payment marking — real gap": order_payment.paymentStatus
// existed but nothing ever flipped it — this closes that gap, bundled into
// the same delivery action a staff member is already standing at the door
// for (CLAUDE.md's own recommendation), not a separate screen. Same staff
// ownership check as updateStatus, since this is conceptually the other
// half of "mark Delivered + Payment Received" (CLAUDE.md order workflow
// step 7) — a staff member shouldn't be able to record a payment against an
// order that isn't theirs any more than they can change its status.
export const recordPayment = async (orderId: string, paymentMethod: PaymentMethod, recordedById: string, role: UserRole) => {
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    const err = new Error(`Invalid paymentMethod: ${paymentMethod}`);
    (err as any).status = 400;
    throw err;
  }

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { customer: true } });

  if (!order) {
    const err = new Error('Order not found.');
    (err as any).status = 404;
    throw err;
  }

  if (role === 'staff' && order.staffId !== recordedById) {
    const err = new Error('Forbidden: you can only record payment for orders assigned to you.');
    (err as any).status = 403;
    throw err;
  }

  // Monthly-billing customers are settled via the ledger (see the
  // billingMode branch above), not a per-order payment at delivery — the
  // four payment modes here are specifically for the "daily payments only"
  // baseline CLAUDE.md describes. Reads order.billingMode (this order's own
  // snapshot), not order.customer.billingMode — same reasoning as the
  // updateStatus branch above.
  if (order.billingMode === 'monthly_billing') {
    const err = new Error('This customer is on monthly billing — payment is settled via the ledger, not per order.');
    (err as any).status = 400;
    throw err;
  }

  // Same discount-adjusted amount the invoice and ledger charge already use
  // (src/utils/pricing.ts) — the recorded Payment must match what the
  // customer was actually asked to pay, not the pre-discount finalAmount.
  const amount = calculatePayableAmount(Number(order.finalAmount), order.customer);

  const updatedOrder = await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        orderId,
        customerId: order.customerId,
        amount,
        paymentType: 'order_payment',
        paymentMethod,
        status: 'success',
        recordedById,
      },
    });

    return tx.order.update({
      where: { id: orderId },
      data: { paymentMethod, paymentStatus: 'paid' },
      include: { customer: { select: customerSelectForRole(role) }, orderItems: true },
    });
  });

  return updatedOrder;
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

// Admin-only (route-gated) — CLAUDE.md "Staff-scoped order visibility" edge
// case, resolved: rather than special-casing staffId at order creation
// (which has no dedicated admin mobile flow anyway — see StaffStack/
// AdminStack), admin gets a general (re)assignment control usable on any
// order at any time, regardless of who created it or who it's currently
// assigned to.
export const assignStaff = async (orderId: string, staffId: string, role: UserRole) => {
  const targetUser = await prisma.user.findUnique({ where: { id: staffId } });

  if (!targetUser || targetUser.role !== 'staff') {
    const err = new Error('staffId must reference an existing staff account.');
    (err as any).status = 400;
    throw err;
  }

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { customer: true } });

  if (!order) {
    const err = new Error('Order not found.');
    (err as any).status = 404;
    throw err;
  }

  if (targetUser.branchId !== order.customer.branchId) {
    const err = new Error("This staff member is not assigned to the order's branch.");
    (err as any).status = 400;
    throw err;
  }

  return prisma.order.update({
    where: { id: orderId },
    data: { staffId },
    include: { customer: { select: customerSelectForRole(role) }, orderItems: true },
  });
};
