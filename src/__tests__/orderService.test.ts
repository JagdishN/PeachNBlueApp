import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/pushService', () => ({
  sendToUser: jest.fn().mockResolvedValue(undefined),
  sendToUsers: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/invoiceService', () => ({
  generateInvoice: jest.fn(),
}));
jest.mock('../services/invoiceReissue.service', () => ({
  reissueInvoice: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/ledgerService', () => ({
  recordCharge: jest.fn().mockResolvedValue(undefined),
}));

import prisma from '../prisma/client';
import { createOrder, listOrders, getOrder, updateStatus, assignStaff, recordPayment } from '../services/orderService';
import { generateInvoice } from '../services/invoiceService';
import { sendNotification } from '../services/notificationService';
import { recordCharge } from '../services/ledgerService';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const generateInvoiceMock = generateInvoice as jest.Mock;
const sendNotificationMock = sendNotification as jest.Mock;
const recordChargeMock = recordCharge as jest.Mock;

const FIXED_PIECE_GARMENT = {
  id: 'g-shirt',
  itemName: "Men's Shirt",
  serviceType: 'dry_clean',
  category: 'Men\'s Wear (Dry Cleaning)',
  pricingUnit: 'per_piece',
  price: 129,
  priceMax: null,
  isStartingPrice: false,
  isActive: true,
  branchId: null,
  displayOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const STARTING_PRICE_GARMENT = {
  ...FIXED_PIECE_GARMENT,
  id: 'g-sofa',
  itemName: 'Sofa Cover',
  category: 'Household',
  price: 300,
  isStartingPrice: true,
};

const PER_KG_GARMENT = {
  ...FIXED_PIECE_GARMENT,
  id: 'g-washfold',
  itemName: 'Wash & Fold (Bulk)',
  category: 'Laundry Services (Per KG)',
  pricingUnit: 'per_kg',
  price: 125,
};

const PER_KG_GARMENT_2 = {
  ...PER_KG_GARMENT,
  id: 'g-premium',
  itemName: 'Premium Laundry (Bulk)',
  price: 200,
};

const baseInput = {
  createdById: 'user-1',
  createdByRole: 'staff' as const,
  branchId: 'branch-1',
  customerName: 'Test Customer',
  customerPhoneNumber: '9999999999',
  locationLabel: 'A-101',
  pickupDate: new Date(),
};

function mockGarments(garments: typeof FIXED_PIECE_GARMENT[]) {
  prismaMock.garmentCatalogue.findMany.mockResolvedValue(garments as any);
}

beforeEach(() => {
  mockReset(prismaMock);
  generateInvoiceMock.mockReset();
  sendNotificationMock.mockReset();
  sendNotificationMock.mockResolvedValue(undefined);
  recordChargeMock.mockReset();
  recordChargeMock.mockResolvedValue(undefined);
  // Never resolves by default — createOrder must not await this, so tests
  // that don't care about the invoice follow-up shouldn't need it to settle.
  generateInvoiceMock.mockReturnValue(new Promise(() => {}));

  prismaMock.$transaction.mockImplementation(((cb: any) => cb(prismaMock)) as any);
  prismaMock.customer.upsert.mockResolvedValue({
    id: 'customer-1',
    phoneNumber: baseInput.customerPhoneNumber,
    whatsappNumber: null,
    billingMode: 'daily',
  } as any);
  prismaMock.order.create.mockImplementation(((args: any) =>
    Promise.resolve({
      id: 'order-1',
      orderNumber: 'PB-TEST',
      estimatedAmount: args.data.estimatedAmount,
      finalAmount: args.data.finalAmount,
      billingMode: args.data.billingMode,
      orderItems: args.data.orderItems.create,
      customer: { id: 'customer-1', phoneNumber: baseInput.customerPhoneNumber, whatsappNumber: null },
    })) as any);
});

describe('createOrder pricing', () => {
  it('regression: pure per-piece order sums quantity x unitPrice', async () => {
    mockGarments([FIXED_PIECE_GARMENT]);

    const order = await createOrder({
      ...baseInput,
      items: [{ garmentId: 'g-shirt', quantity: 3 }],
    });

    expect(order.orderItems).toEqual([
      expect.objectContaining({ quantity: 3, unitPrice: 129, weightKg: null, pricePerKg: null, lineTotal: 387 }),
    ]);
    expect(Number(order.estimatedAmount)).toBe(387);
  });

  it('per-kg order under the 5kg minimum is charged as if it were 5kg', async () => {
    mockGarments([PER_KG_GARMENT]);

    const order = await createOrder({
      ...baseInput,
      items: [{ garmentId: 'g-washfold', weightKg: 3 }],
    });

    // 3kg actual, but minimum 5kg @ ₹125/kg = ₹625.
    expect(order.orderItems).toEqual([
      expect.objectContaining({ weightKg: 3, pricePerKg: 125, lineTotal: 625 }),
    ]);
    expect(Number(order.estimatedAmount)).toBe(625);
  });

  it('per-kg order over the 5kg minimum is charged at actual weight', async () => {
    mockGarments([PER_KG_GARMENT]);

    const order = await createOrder({
      ...baseInput,
      items: [{ garmentId: 'g-washfold', weightKg: 8 }],
    });

    // 8kg @ ₹125/kg = ₹1000, no minimum top-up needed.
    expect(order.orderItems).toEqual([
      expect.objectContaining({ weightKg: 8, pricePerKg: 125, lineTotal: 1000 }),
    ]);
    expect(Number(order.estimatedAmount)).toBe(1000);
  });

  it('mixed per-kg items under the minimum are scaled up proportionally, piece items untouched', async () => {
    mockGarments([PER_KG_GARMENT, PER_KG_GARMENT_2, FIXED_PIECE_GARMENT]);

    const order = await createOrder({
      ...baseInput,
      items: [
        { garmentId: 'g-washfold', weightKg: 2 }, // 2kg @ 125 = 250
        { garmentId: 'g-premium', weightKg: 1 }, // 1kg @ 200 = 200
        { garmentId: 'g-shirt', quantity: 2 }, // 2 @ 129 = 258, untouched by the minimum
      ],
    });

    // Total per-kg weight = 3kg, under the 5kg minimum -> scale factor 5/3.
    // 250 * 5/3 = 416.67, 200 * 5/3 = 333.33; combined per-kg = 750.
    const perKgItems = order.orderItems.filter((i: any) => i.weightKg !== null);
    const pieceItems = order.orderItems.filter((i: any) => i.weightKg === null);

    const perKgTotal = perKgItems.reduce((sum: number, i: any) => sum + i.lineTotal, 0);
    expect(perKgTotal).toBeCloseTo(750, 1);
    expect(pieceItems).toEqual([expect.objectContaining({ quantity: 2, unitPrice: 129, lineTotal: 258 })]);
    expect(Number(order.estimatedAmount)).toBeCloseTo(perKgTotal + 258, 1);
  });

  it('rejects a starting-price item when the submitted price is below the floor', async () => {
    mockGarments([STARTING_PRICE_GARMENT]);

    await expect(
      createOrder({
        ...baseInput,
        items: [{ garmentId: 'g-sofa', chosenPrice: 250 }], // floor is 300
      })
    ).rejects.toThrow(/must be at least/);
  });

  it('accepts a starting-price item at or above the floor', async () => {
    mockGarments([STARTING_PRICE_GARMENT]);

    const order = await createOrder({
      ...baseInput,
      items: [{ garmentId: 'g-sofa', chosenPrice: 350, quantity: 1 }],
    });

    expect(order.orderItems).toEqual([expect.objectContaining({ unitPrice: 350, quantity: 1, lineTotal: 350 })]);
  });
});

// Primary defense (CLAUDE.md "Architecture decision, resolved"): these
// assert at the QUERY-CONSTRUCTION level that discountPercent was never
// even requested for a staff-role call — not just that it's absent from
// the (mocked) response, which wouldn't catch a query site that fetches
// the field and only strips it later.
describe('role-aware customer select (primary defense)', () => {
  it('createOrder never requests discountPercent in the customer select for staff role', async () => {
    mockGarments([FIXED_PIECE_GARMENT]);

    await createOrder({ ...baseInput, createdByRole: 'staff', items: [{ garmentId: 'g-shirt', quantity: 1 }] });

    const createArgs = prismaMock.order.create.mock.calls[0][0] as any;
    expect(createArgs.include.customer.select).not.toHaveProperty('discountPercent');
  });

  it('createOrder includes discountPercent in the customer select for admin role', async () => {
    mockGarments([FIXED_PIECE_GARMENT]);

    await createOrder({ ...baseInput, createdByRole: 'admin', items: [{ garmentId: 'g-shirt', quantity: 1 }] });

    const createArgs = prismaMock.order.create.mock.calls[0][0] as any;
    expect(createArgs.include.customer.select).toHaveProperty('discountPercent', true);
  });

  it('createOrder never requests discountEnabled in the customer select for staff role', async () => {
    mockGarments([FIXED_PIECE_GARMENT]);

    await createOrder({ ...baseInput, createdByRole: 'staff', items: [{ garmentId: 'g-shirt', quantity: 1 }] });

    const createArgs = prismaMock.order.create.mock.calls[0][0] as any;
    expect(createArgs.include.customer.select).not.toHaveProperty('discountEnabled');
  });

  it('createOrder includes discountEnabled in the customer select for admin role', async () => {
    mockGarments([FIXED_PIECE_GARMENT]);

    await createOrder({ ...baseInput, createdByRole: 'admin', items: [{ garmentId: 'g-shirt', quantity: 1 }] });

    const createArgs = prismaMock.order.create.mock.calls[0][0] as any;
    expect(createArgs.include.customer.select).toHaveProperty('discountEnabled', true);
  });

  // CLAUDE.md: billingMode is admin-only to CHANGE but staff must be able to
  // READ it (they need it at delivery to know whether to collect payment) —
  // so, unlike discountPercent/discountEnabled, it must be present for BOTH roles.
  it('createOrder includes billingMode in the customer select for staff role too', async () => {
    mockGarments([FIXED_PIECE_GARMENT]);

    await createOrder({ ...baseInput, createdByRole: 'staff', items: [{ garmentId: 'g-shirt', quantity: 1 }] });

    const createArgs = prismaMock.order.create.mock.calls[0][0] as any;
    expect(createArgs.include.customer.select).toHaveProperty('billingMode', true);
  });

  // CLAUDE.md "Monthly billing retroactivity — RESOLVED": the order stores
  // its own billingMode snapshot, taken from the customer at creation time —
  // not a live reference resolved later at delivery.
  it('snapshots the customer\'s current billingMode onto the new order at creation', async () => {
    mockGarments([FIXED_PIECE_GARMENT]);
    prismaMock.customer.upsert.mockResolvedValue({
      id: 'customer-1',
      phoneNumber: baseInput.customerPhoneNumber,
      whatsappNumber: null,
      billingMode: 'monthly_billing',
    } as any);

    await createOrder({ ...baseInput, items: [{ garmentId: 'g-shirt', quantity: 1 }] });

    const createArgs = prismaMock.order.create.mock.calls[0][0] as any;
    expect(createArgs.data.billingMode).toBe('monthly_billing');
  });

  it('listOrders never requests discountPercent in the customer select for staff role', async () => {
    prismaMock.order.findMany.mockResolvedValue([]);

    await listOrders({ role: 'staff' });

    const findManyArgs = prismaMock.order.findMany.mock.calls[0][0] as any;
    expect(findManyArgs.include.customer.select).not.toHaveProperty('discountPercent');
  });

  it('listOrders includes discountPercent in the customer select for admin role', async () => {
    prismaMock.order.findMany.mockResolvedValue([]);

    await listOrders({ role: 'admin' });

    const findManyArgs = prismaMock.order.findMany.mock.calls[0][0] as any;
    expect(findManyArgs.include.customer.select).toHaveProperty('discountPercent', true);
  });

  it('getOrder never requests discountPercent in the customer select for staff role', async () => {
    prismaMock.order.findFirst.mockResolvedValue(null);

    await getOrder('order-1', 'staff');

    const findFirstArgs = prismaMock.order.findFirst.mock.calls[0][0] as any;
    expect(findFirstArgs.include.customer.select).not.toHaveProperty('discountPercent');
  });

  it('getOrder includes discountPercent in the customer select for admin role', async () => {
    prismaMock.order.findFirst.mockResolvedValue(null);

    await getOrder('order-1', 'admin');

    const findFirstArgs = prismaMock.order.findFirst.mock.calls[0][0] as any;
    expect(findFirstArgs.include.customer.select).toHaveProperty('discountPercent', true);
  });
});

// CLAUDE.md "Staff-scoped order visibility" — each staff member should only
// see/manage orders assigned to them, not every order in their branch.
describe('getOrder / listOrders — staff-scoped visibility', () => {
  it('getOrder scopes by staffId when provided (query-construction level)', async () => {
    prismaMock.order.findFirst.mockResolvedValue(null);

    await getOrder('order-1', 'staff', { branchId: 'branch-1', staffId: 'staff-1' });

    const findFirstArgs = prismaMock.order.findFirst.mock.calls[0][0] as any;
    expect(findFirstArgs.where).toEqual({
      id: 'order-1',
      customer: { branchId: 'branch-1' },
      staffId: 'staff-1',
    });
  });

  it('getOrder applies no branch/staff restriction when scope is omitted (admin, unscoped)', async () => {
    prismaMock.order.findFirst.mockResolvedValue(null);

    await getOrder('order-1', 'admin');

    const findFirstArgs = prismaMock.order.findFirst.mock.calls[0][0] as any;
    expect(findFirstArgs.where).toEqual({ id: 'order-1' });
  });

  it('listOrders filters by staffId when role is staff and staffId is provided', async () => {
    prismaMock.order.findMany.mockResolvedValue([]);

    await listOrders({ role: 'staff', staffId: 'staff-1' });

    const findManyArgs = prismaMock.order.findMany.mock.calls[0][0] as any;
    expect(findManyArgs.where).toEqual(expect.objectContaining({ staffId: 'staff-1' }));
  });

  it('listOrders does not filter by staffId for admin even if one were passed', async () => {
    prismaMock.order.findMany.mockResolvedValue([]);

    await listOrders({ role: 'admin', staffId: 'staff-1' });

    const findManyArgs = prismaMock.order.findMany.mock.calls[0][0] as any;
    expect(findManyArgs.where).not.toHaveProperty('staffId');
  });
});

// CLAUDE.md: PDF generation must run as a background job, never inline with
// the request that completes an order — so createOrder must resolve without
// waiting on generateInvoice.
describe('createOrder — invoice generation is non-blocking', () => {
  it('resolves even while generateInvoice is still pending', async () => {
    mockGarments([FIXED_PIECE_GARMENT]);
    generateInvoiceMock.mockReturnValue(new Promise(() => {})); // never settles

    await expect(
      createOrder({ ...baseInput, items: [{ garmentId: 'g-shirt', quantity: 1 }] })
    ).resolves.toBeDefined();
  });

  it('resolves even when generateInvoice rejects', async () => {
    mockGarments([FIXED_PIECE_GARMENT]);
    generateInvoiceMock.mockRejectedValue(new Error('razorpay unavailable'));

    await expect(
      createOrder({ ...baseInput, items: [{ garmentId: 'g-shirt', quantity: 1 }] })
    ).resolves.toBeDefined();
  });

  it('sends a second pickup_confirmation with the invoice details once generateInvoice resolves', async () => {
    mockGarments([FIXED_PIECE_GARMENT]);
    generateInvoiceMock.mockResolvedValue({
      amount: 129,
      paymentLinkUrl: 'https://rzp.io/l/x',
      pdfUrl: 'https://storage.example/inv.pdf',
      wasReissue: false,
    });

    await createOrder({ ...baseInput, items: [{ garmentId: 'g-shirt', quantity: 1 }] });
    // Flush the microtask queue so the un-awaited .then() chain runs.
    await new Promise((resolve) => setImmediate(resolve));

    const invoiceCall = sendNotificationMock.mock.calls.find((call: any) => call[2].includes('rzp.io'));
    expect(invoiceCall).toBeDefined();
    expect(invoiceCall[1]).toBe('pickup_confirmation');
    expect(invoiceCall[4]).toBe('https://storage.example/inv.pdf');
  });
});

// CLAUDE.md "Monthly billing + discount: now live" — delivery-time behavior
// must branch on billingMode: monthly-billing customers accrue a ledger
// charge instead of being required to pay per-order; daily customers are
// unaffected (regression check that this branch doesn't fire for them).
describe('updateStatus — delivery billingMode branch', () => {
  // billingMode lives on the order itself now (a snapshot taken at
  // creation — CLAUDE.md "Monthly billing retroactivity — RESOLVED"), not
  // read live off order.customer. customer.billingMode is deliberately
  // omitted/different here in a couple of tests below to prove the branch
  // really reads the order's own field, not the customer's current one.
  const buildOrderUpdate = (billingMode: 'daily' | 'monthly_billing') => ({
    id: 'order-1',
    orderNumber: 'PB-TEST',
    finalAmount: 500,
    billingMode,
    customer: { id: 'customer-1' },
  });

  // All tests in this block call updateStatus with role 'staff' and
  // changedById 'user-1' — the new ownership pre-check (CLAUDE.md
  // "Staff-scoped order visibility") needs the order's assigned staffId to
  // match, or it 403s before reaching the billingMode logic these tests
  // actually care about.
  beforeEach(() => {
    prismaMock.order.findUnique.mockResolvedValue({ staffId: 'user-1' } as any);
  });

  it('posts a ledger charge when a monthly-billing customer\'s order is marked delivered', async () => {
    prismaMock.order.update.mockResolvedValue(buildOrderUpdate('monthly_billing') as any);
    prismaMock.orderStatusHistory.create.mockResolvedValue({} as any);
    prismaMock.customer.findUnique.mockResolvedValue({ discountEnabled: false, discountPercent: 0 } as any);

    await updateStatus('order-1', 'delivered', 'user-1', 'staff');

    expect(recordChargeMock).toHaveBeenCalledWith('customer-1', 'order-1', 500, 'Order PB-TEST');
  });

  it('does not post a ledger charge for a daily customer\'s delivered order (regression)', async () => {
    prismaMock.order.update.mockResolvedValue(buildOrderUpdate('daily') as any);
    prismaMock.orderStatusHistory.create.mockResolvedValue({} as any);

    await updateStatus('order-1', 'delivered', 'user-1', 'staff');

    expect(recordChargeMock).not.toHaveBeenCalled();
    expect(prismaMock.customer.findUnique).not.toHaveBeenCalled();
  });

  it('does not post a ledger charge for a monthly-billing customer on a non-delivered transition', async () => {
    prismaMock.order.update.mockResolvedValue(buildOrderUpdate('monthly_billing') as any);
    prismaMock.orderStatusHistory.create.mockResolvedValue({} as any);

    await updateStatus('order-1', 'washing', 'user-1', 'staff');

    expect(recordChargeMock).not.toHaveBeenCalled();
  });

  // "Known gaps found during the billing/discount toggle work": the ledger
  // charge used to post the raw finalAmount even when the customer had a
  // discount enabled, disagreeing with what their invoice actually says.
  it('charges the discount-adjusted amount, not the raw finalAmount, when the customer has a discount enabled', async () => {
    prismaMock.order.update.mockResolvedValue(buildOrderUpdate('monthly_billing') as any);
    prismaMock.orderStatusHistory.create.mockResolvedValue({} as any);
    prismaMock.customer.findUnique.mockResolvedValue({ discountEnabled: true, discountPercent: 10 } as any);

    await updateStatus('order-1', 'delivered', 'user-1', 'staff');

    // finalAmount 500, 10% off -> 450.
    expect(recordChargeMock).toHaveBeenCalledWith('customer-1', 'order-1', 450, 'Order PB-TEST');
  });

  it('charges the full amount when discountEnabled is false, even if a percent is stored', async () => {
    prismaMock.order.update.mockResolvedValue(buildOrderUpdate('monthly_billing') as any);
    prismaMock.orderStatusHistory.create.mockResolvedValue({} as any);
    prismaMock.customer.findUnique.mockResolvedValue({ discountEnabled: false, discountPercent: 10 } as any);

    await updateStatus('order-1', 'delivered', 'user-1', 'staff');

    expect(recordChargeMock).toHaveBeenCalledWith('customer-1', 'order-1', 500, 'Order PB-TEST');
  });

  it('reads discount fields directly rather than from the role-scoped order.customer (staff-initiated delivery)', async () => {
    // order.customer here has no discountEnabled/discountPercent at all —
    // exactly what customerSelectForRole('staff') produces — so this proves
    // the branch doesn't (and can't) read discount fields off it.
    prismaMock.order.update.mockResolvedValue(buildOrderUpdate('monthly_billing') as any);
    prismaMock.orderStatusHistory.create.mockResolvedValue({} as any);
    prismaMock.customer.findUnique.mockResolvedValue({ discountEnabled: true, discountPercent: 20 } as any);

    await updateStatus('order-1', 'delivered', 'user-1', 'staff');

    expect(prismaMock.customer.findUnique).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      select: { discountEnabled: true, discountPercent: true },
    });
    expect(recordChargeMock).toHaveBeenCalledWith('customer-1', 'order-1', 400, 'Order PB-TEST');
  });

  // CLAUDE.md "Monthly billing retroactivity — RESOLVED": flipping a
  // customer's billingMode must not retroactively change how an
  // already-created order settles — the order's own snapshot wins.
  it('does not post a ledger charge for an order snapshotted as daily, even if the customer is now monthly_billing', async () => {
    prismaMock.order.update.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PB-TEST',
      finalAmount: 500,
      billingMode: 'daily',
      customer: { id: 'customer-1', billingMode: 'monthly_billing' },
    } as any);
    prismaMock.orderStatusHistory.create.mockResolvedValue({} as any);

    await updateStatus('order-1', 'delivered', 'user-1', 'staff');

    expect(recordChargeMock).not.toHaveBeenCalled();
  });

  it('posts a ledger charge for an order snapshotted as monthly_billing, even if the customer is now daily', async () => {
    prismaMock.order.update.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PB-TEST',
      finalAmount: 500,
      billingMode: 'monthly_billing',
      customer: { id: 'customer-1', billingMode: 'daily' },
    } as any);
    prismaMock.orderStatusHistory.create.mockResolvedValue({} as any);
    prismaMock.customer.findUnique.mockResolvedValue({ discountEnabled: false, discountPercent: 0 } as any);

    await updateStatus('order-1', 'delivered', 'user-1', 'staff');

    expect(recordChargeMock).toHaveBeenCalledWith('customer-1', 'order-1', 500, 'Order PB-TEST');
  });
});

// CLAUDE.md "Staff-scoped order visibility" (write side): a staff member may
// only update the status of an order actually assigned to them.
describe('updateStatus — staff ownership check', () => {
  it('rejects with 403 when the requesting staff member is not the order\'s assigned staffId', async () => {
    prismaMock.order.findUnique.mockResolvedValue({ staffId: 'staff-1' } as any);

    await expect(updateStatus('order-1', 'washing', 'staff-2', 'staff')).rejects.toMatchObject({
      status: 403,
    });

    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });

  it('allows the update when the requesting staff member IS the order\'s assigned staffId', async () => {
    prismaMock.order.findUnique.mockResolvedValue({ staffId: 'staff-1' } as any);
    prismaMock.order.update.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PB-TEST',
      finalAmount: 500,
      customer: { id: 'customer-1', billingMode: 'daily' },
    } as any);
    prismaMock.orderStatusHistory.create.mockResolvedValue({} as any);

    await expect(updateStatus('order-1', 'washing', 'staff-1', 'staff')).resolves.toBeDefined();
    expect(prismaMock.order.update).toHaveBeenCalled();
  });

  it('rejects with 404 when the order does not exist', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);

    await expect(updateStatus('missing-order', 'washing', 'staff-1', 'staff')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('does not run the ownership check for admin — any admin can update any order in scope', async () => {
    prismaMock.order.update.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PB-TEST',
      finalAmount: 500,
      customer: { id: 'customer-1', billingMode: 'daily' },
    } as any);
    prismaMock.orderStatusHistory.create.mockResolvedValue({} as any);

    await expect(updateStatus('order-1', 'washing', 'admin-1', 'admin')).resolves.toBeDefined();
    // The staffId pre-check query only runs for role === 'staff'.
    expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
  });
});

// CLAUDE.md "Payment marking — real gap": closes the gap where
// order.paymentStatus never got flipped and no payment method was recorded.
describe('recordPayment', () => {
  it('rejects an invalid paymentMethod before touching the database', async () => {
    await expect(recordPayment('order-1', 'bitcoin' as any, 'staff-1', 'staff')).rejects.toMatchObject({
      status: 400,
    });
    expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
  });

  it('rejects with 404 when the order does not exist', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);

    await expect(recordPayment('missing-order', 'cash', 'staff-1', 'staff')).rejects.toMatchObject({
      status: 404,
    });
  });

  it("rejects with 403 when a staff member records payment for an order that isn't theirs", async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      staffId: 'staff-1',
      finalAmount: 500,
      billingMode: 'daily',
      customer: { id: 'customer-1', discountEnabled: false, discountPercent: 0 },
    } as any);

    await expect(recordPayment('order-1', 'cash', 'staff-2', 'staff')).rejects.toMatchObject({ status: 403 });
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it('rejects an order snapshotted as monthly-billing — settled via the ledger, not per-order payment', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      staffId: 'staff-1',
      finalAmount: 500,
      billingMode: 'monthly_billing',
      customer: { id: 'customer-1', discountEnabled: false, discountPercent: 0 },
    } as any);

    await expect(recordPayment('order-1', 'cash', 'staff-1', 'staff')).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  // CLAUDE.md "Monthly billing retroactivity — RESOLVED": the order's own
  // snapshot governs, not the customer's current (possibly since-changed)
  // billingMode.
  it('allows recording payment for an order snapshotted as daily, even if the customer is now monthly_billing', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      customerId: 'customer-1',
      staffId: 'staff-1',
      finalAmount: 500,
      billingMode: 'daily',
      customer: { id: 'customer-1', billingMode: 'monthly_billing', discountEnabled: false, discountPercent: 0 },
    } as any);
    prismaMock.payment.create.mockResolvedValue({} as any);
    prismaMock.order.update.mockResolvedValue({ id: 'order-1', paymentStatus: 'paid', paymentMethod: 'cash' } as any);

    await expect(recordPayment('order-1', 'cash', 'staff-1', 'staff')).resolves.toBeDefined();
    expect(prismaMock.payment.create).toHaveBeenCalled();
  });

  it('rejects an order snapshotted as monthly-billing, even if the customer is now daily', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      staffId: 'staff-1',
      finalAmount: 500,
      billingMode: 'monthly_billing',
      customer: { id: 'customer-1', billingMode: 'daily', discountEnabled: false, discountPercent: 0 },
    } as any);

    await expect(recordPayment('order-1', 'cash', 'staff-1', 'staff')).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it('creates a Payment row and flips the order to paid with the given method, for a daily customer', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      customerId: 'customer-1',
      staffId: 'staff-1',
      finalAmount: 500,
      billingMode: 'daily',
      customer: { id: 'customer-1', discountEnabled: false, discountPercent: 0 },
    } as any);
    prismaMock.payment.create.mockResolvedValue({} as any);
    prismaMock.order.update.mockResolvedValue({
      id: 'order-1',
      paymentStatus: 'paid',
      paymentMethod: 'upi',
    } as any);

    await recordPayment('order-1', 'upi', 'staff-1', 'staff');

    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'order-1',
          customerId: 'customer-1',
          amount: 500,
          paymentType: 'order_payment',
          paymentMethod: 'upi',
          status: 'success',
          recordedById: 'staff-1',
        }),
      })
    );
    expect(prismaMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-1' },
        data: { paymentMethod: 'upi', paymentStatus: 'paid' },
      })
    );
  });

  it('records the discount-adjusted amount, not the raw finalAmount, when the customer has a discount', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      customerId: 'customer-1',
      staffId: 'staff-1',
      finalAmount: 500,
      billingMode: 'daily',
      customer: { id: 'customer-1', discountEnabled: true, discountPercent: 10 },
    } as any);
    prismaMock.payment.create.mockResolvedValue({} as any);
    prismaMock.order.update.mockResolvedValue({} as any);

    await recordPayment('order-1', 'cash', 'staff-1', 'staff');

    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 450 }) })
    );
  });
});

// CLAUDE.md "Staff-scoped order visibility" edge case, resolved: admin gets
// a general (re)assignment control rather than special-casing staffId at
// order creation.
describe('assignStaff — admin (re)assignment', () => {
  it('rejects when the target user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(assignStaff('order-1', 'not-a-user', 'admin')).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });

  it('rejects when the target user is an admin, not staff', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'admin-2', role: 'admin', branchId: null } as any);

    await expect(assignStaff('order-1', 'admin-2', 'admin')).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });

  it('rejects when the order does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'staff-2', role: 'staff', branchId: 'branch-1' } as any);
    prismaMock.order.findUnique.mockResolvedValue(null);

    await expect(assignStaff('missing-order', 'staff-2', 'admin')).rejects.toMatchObject({ status: 404 });
  });

  it("rejects when the staff member's branch doesn't match the order's branch", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'staff-2', role: 'staff', branchId: 'branch-2' } as any);
    prismaMock.order.findUnique.mockResolvedValue({ id: 'order-1', customer: { branchId: 'branch-1' } } as any);

    await expect(assignStaff('order-1', 'staff-2', 'admin')).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });

  it('reassigns the order when the target is a valid staff member in the same branch', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'staff-2', role: 'staff', branchId: 'branch-1' } as any);
    prismaMock.order.findUnique.mockResolvedValue({ id: 'order-1', customer: { branchId: 'branch-1' } } as any);
    prismaMock.order.update.mockResolvedValue({ id: 'order-1', staffId: 'staff-2' } as any);

    await assignStaff('order-1', 'staff-2', 'admin');

    expect(prismaMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-1' }, data: { staffId: 'staff-2' } })
    );
  });
});
