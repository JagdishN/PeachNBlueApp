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

import prisma from '../prisma/client';
import { createOrder, listOrders, getOrder } from '../services/orderService';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

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

  prismaMock.$transaction.mockImplementation(((cb: any) => cb(prismaMock)) as any);
  prismaMock.customer.upsert.mockResolvedValue({
    id: 'customer-1',
    phoneNumber: baseInput.customerPhoneNumber,
    whatsappNumber: null,
  } as any);
  prismaMock.order.create.mockImplementation(((args: any) =>
    Promise.resolve({
      id: 'order-1',
      orderNumber: 'PB-TEST',
      estimatedAmount: args.data.estimatedAmount,
      finalAmount: args.data.finalAmount,
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
    prismaMock.order.findUnique.mockResolvedValue(null);

    await getOrder('order-1', 'staff');

    const findUniqueArgs = prismaMock.order.findUnique.mock.calls[0][0] as any;
    expect(findUniqueArgs.include.customer.select).not.toHaveProperty('discountPercent');
  });

  it('getOrder includes discountPercent in the customer select for admin role', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);

    await getOrder('order-1', 'admin');

    const findUniqueArgs = prismaMock.order.findUnique.mock.calls[0][0] as any;
    expect(findUniqueArgs.include.customer.select).toHaveProperty('discountPercent', true);
  });
});
