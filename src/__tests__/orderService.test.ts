import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
  notifyAdminsOfPickup: jest.fn().mockResolvedValue(undefined),
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
import { createOrder, listOrders, getOrder, updateStatus, assignStaff, recordPayment, recordOnlinePayment } from '../services/orderService';
import { generateInvoice } from '../services/invoiceService';
import { sendNotification, notifyAdminsOfPickup } from '../services/notificationService';
import { recordCharge } from '../services/ledgerService';
import { MSG91_TEMPLATES } from '../constants/msg91Templates';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const generateInvoiceMock = generateInvoice as jest.Mock;
const sendNotificationMock = sendNotification as jest.Mock;
const notifyAdminsOfPickupMock = notifyAdminsOfPickup as jest.Mock;
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
  notifyAdminsOfPickupMock.mockReset();
  notifyAdminsOfPickupMock.mockResolvedValue(undefined);
  recordChargeMock.mockReset();
  recordChargeMock.mockResolvedValue(undefined);
  // Never resolves by default — createOrder must not await this, so tests
  // that don't care about the invoice follow-up shouldn't need it to settle.
  generateInvoiceMock.mockReturnValue(new Promise(() => {}));

  prismaMock.$transaction.mockImplementation(((cb: any) => cb(prismaMock)) as any);
  prismaMock.customer.upsert.mockResolvedValue({
    id: 'customer-1',
    fullName: baseInput.customerName,
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
      customer: {
        id: 'customer-1',
        fullName: baseInput.customerName,
        phoneNumber: baseInput.customerPhoneNumber,
        whatsappNumber: null,
        branch: { whatsappNumber: null },
      },
    })) as any);
  // Default: no admins found for the pickup-notification lookup — tests
  // that specifically care about it override this themselves.
  prismaMock.user.findMany.mockResolvedValue([]);
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

  // CLAUDE.md "Branches": every branch sends WhatsApp from its own number —
  // not sensitive, so present for both roles (unlike discountPercent above).
  it('createOrder always includes branch.whatsappNumber in the customer select, both roles', async () => {
    mockGarments([FIXED_PIECE_GARMENT]);

    await createOrder({ ...baseInput, createdByRole: 'staff', items: [{ garmentId: 'g-shirt', quantity: 1 }] });

    const createArgs = prismaMock.order.create.mock.calls[0][0] as any;
    expect(createArgs.include.customer.select.branch).toEqual({ select: { whatsappNumber: true } });
  });
});

// CLAUDE.md order workflow item 4a: admin(s) get a WhatsApp notification
// when staff confirms a pickup, sent from the order's branch's own number.
describe('createOrder — admin pickup notification', () => {
  it('looks up unscoped admins plus admins scoped to the order\'s branch, excluding the creator', async () => {
    mockGarments([FIXED_PIECE_GARMENT]);

    await createOrder({
      ...baseInput,
      createdById: 'staff-1',
      createdByRole: 'staff',
      items: [{ garmentId: 'g-shirt', quantity: 1 }],
    });

    const findManyArgs = prismaMock.user.findMany.mock.calls[0][0] as any;
    expect(findManyArgs.where).toEqual({
      role: 'admin',
      id: { not: 'staff-1' },
      OR: [{ branchId: null }, { branchId: baseInput.branchId }],
    });
  });

  it('sends a WhatsApp notification to found admins, from the branch\'s own WhatsApp number', async () => {
    mockGarments([FIXED_PIECE_GARMENT]);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'admin-1', phoneNumber: '9000000001' },
      { id: 'admin-2', phoneNumber: '9000000002' },
    ] as any);
    prismaMock.order.create.mockResolvedValueOnce({
      id: 'order-1',
      orderNumber: 'PB-TEST',
      estimatedAmount: 129,
      finalAmount: 129,
      billingMode: 'daily',
      orderItems: [],
      customer: {
        id: 'customer-1',
        phoneNumber: baseInput.customerPhoneNumber,
        whatsappNumber: null,
        branch: { whatsappNumber: '+919398125151' },
      },
    } as any);

    await createOrder({ ...baseInput, items: [{ garmentId: 'g-shirt', quantity: 1 }] });

    // Regression guard (2026-09-03): the admin pickup notice now reuses
    // pickupConfirmation instead of the separate, never-approved
    // adminPickupNotification template — per explicit client decision.
    expect(notifyAdminsOfPickupMock).toHaveBeenCalledWith(
      [
        { id: 'admin-1', phoneNumber: '9000000001' },
        { id: 'admin-2', phoneNumber: '9000000002' },
      ],
      expect.objectContaining({
        name: MSG91_TEMPLATES.pickupConfirmation.name,
        language: MSG91_TEMPLATES.pickupConfirmation.language,
        bodyVariables: expect.arrayContaining(['PB-TEST']),
      }),
      '+919398125151'
    );
  });

  it('does not send an admin notification when no relevant admins are found', async () => {
    mockGarments([FIXED_PIECE_GARMENT]);
    prismaMock.user.findMany.mockResolvedValue([]);

    await createOrder({ ...baseInput, items: [{ garmentId: 'g-shirt', quantity: 1 }] });

    expect(notifyAdminsOfPickupMock).not.toHaveBeenCalled();
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

  // RESOLVED (2026-09-03): real template is `generate_invoice` — real
  // pulled definition shows body_1/2/3 + a URL button, no document-header.
  // Real gap found the same day via a live send: the template's fixed text
  // ends "...Scan the QR code in your invoice, or tap below to pay online"
  // — it presupposes the customer already has the PDF, but there's no
  // header component and no spare body variable for a link. Fixed by
  // appending the PDF link onto {{3}} as plain text (WhatsApp auto-links
  // it), same mechanism already proven for invoice_reissued.
  it('sends a second pickup_confirmation with the invoice details (PDF link appended to the amount) once generateInvoice resolves', async () => {
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

    // Qualify by buttonUrlParam (only the follow-up invoice message passes
    // one — the instant synchronous message doesn't).
    const invoiceCall = sendNotificationMock.mock.calls.find((call: any) => call[2].buttonUrlParam === '/x');
    expect(invoiceCall).toBeDefined();
    expect(invoiceCall[1]).toBe('pickup_confirmation');
    expect(invoiceCall[2].name).toBe(MSG91_TEMPLATES.invoiceReady.name);
    expect(invoiceCall[2].bodyVariables).toEqual([
      baseInput.customerName,
      'PB-TEST',
      '129. Invoice: https://storage.example/inv.pdf',
    ]);
  });

  it('falls back to the bare amount when pdfUrl is somehow null', async () => {
    mockGarments([FIXED_PIECE_GARMENT]);
    generateInvoiceMock.mockResolvedValue({
      amount: 129,
      paymentLinkUrl: 'https://rzp.io/l/x',
      pdfUrl: null,
      wasReissue: false,
    });

    await createOrder({ ...baseInput, items: [{ garmentId: 'g-shirt', quantity: 1 }] });
    await new Promise((resolve) => setImmediate(resolve));

    const invoiceCall = sendNotificationMock.mock.calls.find((call: any) => call[2].buttonUrlParam === '/x');
    expect(invoiceCall[2].bodyVariables).toEqual([baseInput.customerName, 'PB-TEST', '129']);
  });

  // invoiceService.ts no longer creates a real Razorpay link for
  // monthly-billing orders — paymentLinkUrl comes back null. The real
  // generate_invoice template has no fallback text slot the way the old
  // placeholder version did (no button param to give without a real URL),
  // so this notification is skipped entirely, same precedent as
  // invoiceReissued/delivery_confirmation.
  it('skips the follow-up notification entirely (no button to send) when paymentLinkUrl is null', async () => {
    mockGarments([FIXED_PIECE_GARMENT]);
    generateInvoiceMock.mockResolvedValue({
      amount: 129,
      paymentLinkUrl: null,
      pdfUrl: 'https://storage.example/inv.pdf',
      wasReissue: false,
    });

    await createOrder({ ...baseInput, items: [{ garmentId: 'g-shirt', quantity: 1 }] });
    await new Promise((resolve) => setImmediate(resolve));

    const invoiceCall = sendNotificationMock.mock.calls.find((call: any) => call[2].buttonUrlParam !== undefined);
    expect(invoiceCall).toBeUndefined();
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
  const buildOrderUpdate = (billingMode: 'daily' | 'monthly_billing', paymentStatus: string = 'paid') => ({
    id: 'order-1',
    orderNumber: 'PB-TEST',
    finalAmount: 500,
    billingMode,
    paymentStatus,
    customer: { id: 'customer-1', fullName: 'Test Customer' },
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
    // paymentStatus defaults to 'paid' here (buildOrderUpdate) — the normal
    // case, since the mobile app bundles recordPayment before this status
    // update. discountEnabled/discountPercent are still looked up (needed
    // either for the ledger charge or the delivery_confirmation amount —
    // see the dedicated describe block below), just not acted on here.
    prismaMock.order.update.mockResolvedValue(buildOrderUpdate('daily') as any);
    prismaMock.orderStatusHistory.create.mockResolvedValue({} as any);
    prismaMock.customer.findUnique.mockResolvedValue({ discountEnabled: false, discountPercent: 0 } as any);

    await updateStatus('order-1', 'delivered', 'user-1', 'staff');

    expect(recordChargeMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
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

// CLAUDE.md "Approved WhatsApp Templates" / delivery_confirmation wiring
// (2026-09-02, "Razorpay/delivery_confirmation button wiring"): only fires
// when payment genuinely hasn't been collected yet at the delivered
// transition — confirmed via AskUserQuestion given the real risk of sending
// a customer a factually wrong "Amount due" message.
describe('updateStatus — delivery_confirmation', () => {
  const CUSTOMER = {
    id: 'customer-1',
    fullName: 'Test Customer',
    phoneNumber: '9999999999',
    whatsappNumber: null,
    branch: { whatsappNumber: '917013725151' },
  };

  beforeEach(() => {
    prismaMock.order.findUnique.mockResolvedValue({ staffId: 'user-1' } as any);
    prismaMock.orderStatusHistory.create.mockResolvedValue({} as any);
    prismaMock.customer.findUnique.mockResolvedValue({ discountEnabled: false, discountPercent: 0 } as any);
  });

  // RE-CORRECTED (2026-09-03): a pulled sample briefly showed no button on
  // this template, so the link was moved into plain body text — the client
  // then confirmed delivery_confirmation genuinely has a real button_1 (the
  // payment link) after all. Back to a button, suffix-only.
  it('sends delivery_confirmation with the customer name, order#, amount due, and the payment link suffix as a button param — unpaid daily order with a real link', async () => {
    prismaMock.order.update.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PB-TEST',
      finalAmount: 500,
      billingMode: 'daily',
      paymentStatus: 'pending',
      customer: CUSTOMER,
    } as any);
    prismaMock.invoice.findUnique.mockResolvedValue({ paymentLinkUrl: 'https://rzp.io/l/AbCd1234' } as any);

    await updateStatus('order-1', 'delivered', 'user-1', 'staff');

    expect(prismaMock.invoice.findUnique).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
      select: { paymentLinkUrl: true },
    });
    expect(sendNotificationMock).toHaveBeenCalledWith(
      CUSTOMER,
      'delivery_confirmation',
      {
        name: MSG91_TEMPLATES.deliveryConfirmation.name,
        language: MSG91_TEMPLATES.deliveryConfirmation.language,
        bodyVariables: ['Test Customer', 'PB-TEST', '500'],
        buttonUrlParam: '/AbCd1234',
      },
      'order-1'
    );
  });

  it('does not send delivery_confirmation when payment is already recorded (the normal bundled staff flow)', async () => {
    prismaMock.order.update.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PB-TEST',
      finalAmount: 500,
      billingMode: 'daily',
      paymentStatus: 'paid',
      customer: CUSTOMER,
    } as any);

    await updateStatus('order-1', 'delivered', 'user-1', 'staff');

    expect(prismaMock.invoice.findUnique).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('does not send delivery_confirmation for a monthly-billing order, even if unpaid (no real payment link, settled via the ledger)', async () => {
    prismaMock.order.update.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PB-TEST',
      finalAmount: 500,
      billingMode: 'monthly_billing',
      paymentStatus: 'pending',
      customer: CUSTOMER,
    } as any);

    await updateStatus('order-1', 'delivered', 'user-1', 'staff');

    expect(prismaMock.invoice.findUnique).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('does not send delivery_confirmation when unpaid but no invoice/payment link exists yet', async () => {
    prismaMock.order.update.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PB-TEST',
      finalAmount: 500,
      billingMode: 'daily',
      paymentStatus: 'pending',
      customer: CUSTOMER,
    } as any);
    prismaMock.invoice.findUnique.mockResolvedValue(null);

    await updateStatus('order-1', 'delivered', 'user-1', 'staff');

    expect(sendNotificationMock).not.toHaveBeenCalled();
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

// Webhook-driven counterpart to recordPayment — see CLAUDE.md "Razorpay
// webhook — implemented" for why this is a separate function (no human
// requester, so no role/staff-ownership args) rather than recordPayment
// reused with a synthetic actor.
describe('recordOnlinePayment', () => {
  it('returns order_not_found without touching Payment/Order tables when the order does not exist', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);

    const result = await recordOnlinePayment('missing-order', 'upi', 499, 'pay_1', 'upi');

    expect(result).toEqual({ status: 'order_not_found' });
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it('is idempotent — a redelivered webhook for an already-paid order is a no-op', async () => {
    prismaMock.order.findUnique.mockResolvedValue({ id: 'order-1', paymentStatus: 'paid', billingMode: 'daily' } as any);

    const result = await recordOnlinePayment('order-1', 'upi', 499, 'pay_1', 'upi');

    expect(result).toEqual({ status: 'already_paid' });
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it('flags a monthly-billing order as an anomaly rather than auto-reconciling it (avoids double-counting against the ledger)', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      paymentStatus: 'pending',
      billingMode: 'monthly_billing',
    } as any);

    const result = await recordOnlinePayment('order-1', 'upi', 499, 'pay_1', 'upi');

    expect(result).toEqual({ status: 'monthly_billing_anomaly' });
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });

  it('records a Payment with recordedById null and the raw Razorpay method in notes, then flips the order to paid', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PB-TEST1234',
      customerId: 'customer-1',
      paymentStatus: 'pending',
      billingMode: 'daily',
      customer: { id: 'customer-1', phoneNumber: '9999999999', whatsappNumber: null },
    } as any);
    prismaMock.payment.create.mockResolvedValue({} as any);
    prismaMock.order.update.mockResolvedValue({} as any);
    prismaMock.invoice.updateMany.mockResolvedValue({ count: 1 } as any);

    const result = await recordOnlinePayment('order-1', 'upi', 499, 'pay_1', 'upi');

    expect(result).toEqual({ status: 'paid' });
    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'order-1',
          customerId: 'customer-1',
          amount: 499,
          paymentType: 'order_payment',
          paymentMethod: 'upi',
          status: 'success',
          razorpayPaymentId: 'pay_1',
          recordedById: null,
          notes: 'Razorpay method: upi',
        }),
      })
    );
    expect(prismaMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-1' }, data: { paymentMethod: 'upi', paymentStatus: 'paid' } })
    );
    expect(prismaMock.invoice.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
      data: { paymentLinkStatus: 'paid' },
    });
  });

  // The gap this closes: a customer paying online via the Razorpay link
  // previously got no confirmation at all — only the staff-recorded
  // recordPayment path's absence of a notification was "expected" (staff is
  // standing right there); an online payment has no equivalent human touch.
  it('sends a payment_receipt WhatsApp notification with the order number, amount, and method label', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'PB-TEST1234',
      customerId: 'customer-1',
      paymentStatus: 'pending',
      billingMode: 'daily',
      customer: { id: 'customer-1', fullName: 'Test Customer', phoneNumber: '9999999999', whatsappNumber: null },
    } as any);
    prismaMock.payment.create.mockResolvedValue({} as any);
    prismaMock.order.update.mockResolvedValue({} as any);
    prismaMock.invoice.updateMany.mockResolvedValue({ count: 1 } as any);

    await recordOnlinePayment('order-1', 'net_banking', 499, 'pay_1', 'netbanking');

    expect(sendNotificationMock).toHaveBeenCalledWith(
      { id: 'customer-1', fullName: 'Test Customer', phoneNumber: '9999999999', whatsappNumber: null },
      'payment_receipt',
      // Approved template's variable order is name, amount, order#, method.
      {
        name: MSG91_TEMPLATES.paymentReceipt.name,
        language: MSG91_TEMPLATES.paymentReceipt.language,
        bodyVariables: ['Test Customer', '499', 'PB-TEST1234', 'Net Banking'],
      },
      'order-1'
    );
  });

  it('does not send a notification when the payment is not actually recorded (already_paid / monthly_billing_anomaly / order_not_found)', async () => {
    prismaMock.order.findUnique.mockResolvedValue({ id: 'order-1', paymentStatus: 'paid', billingMode: 'daily' } as any);

    await recordOnlinePayment('order-1', 'upi', 499, 'pay_1', 'upi');

    expect(sendNotificationMock).not.toHaveBeenCalled();
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
