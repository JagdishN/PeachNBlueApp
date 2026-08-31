import 'express-async-errors';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
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
  generateInvoice: jest.fn().mockReturnValue(new Promise(() => {})),
}));
jest.mock('../config', () => ({ JWT_SECRET: 'test-secret-key' }));

import prisma from '../prisma/client';
import { errorHandler } from '../middleware/errorHandler';
import { JWT_SECRET } from '../config';
import orderRoutes from '../routes/orders';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const app = express();
app.use(express.json());
app.use('/api/v1/orders', orderRoutes);
app.use(errorHandler);

const token = (role: 'staff' | 'admin', branchId: string | null = null, userId = 'user-1') =>
  jwt.sign({ userId, role, branchId }, JWT_SECRET);

beforeEach(() => {
  mockReset(prismaMock);
  prismaMock.$transaction.mockImplementation(((cb: any) => cb(prismaMock)) as any);
  // Default: no admins found for the pickup-notification lookup that
  // createOrder now runs (CLAUDE.md order workflow item 4a).
  prismaMock.user.findMany.mockResolvedValue([]);
});

// CLAUDE.md "Staff-scoped order visibility": a staff caller must not be able
// to hand an order to a colleague by passing staffId in the request body —
// that would defeat the ownership checks on list/get/updateStatus.
describe('POST / — staffId trust (staff cannot assign to someone else)', () => {
  const validBody = {
    customerName: 'Priya Menon',
    customerPhoneNumber: '+919999999999',
    locationLabel: 'A-101',
    branchId: 'branch-1',
    pickupDate: new Date().toISOString(),
    items: [{ garmentId: 'g-1', quantity: 1 }],
  };

  beforeEach(() => {
    prismaMock.garmentCatalogue.findMany.mockResolvedValue([
      { id: 'g-1', itemName: 'Shirt', pricingUnit: 'per_piece', price: 100, priceMax: null, isStartingPrice: false } as any,
    ]);
    prismaMock.customer.upsert.mockResolvedValue({ id: 'customer-1', branchId: 'branch-1' } as any);
    prismaMock.order.create.mockImplementation(((args: any) =>
      Promise.resolve({
        id: 'order-1',
        orderNumber: 'PB-TEST',
        estimatedAmount: args.data.estimatedAmount,
        finalAmount: args.data.finalAmount,
        staffId: args.data.staffId,
        orderItems: args.data.orderItems.create,
        customer: { id: 'customer-1', branch: { whatsappNumber: null } },
      })) as any);
  });

  it('forces staffId to the caller\'s own id for a staff-role request, ignoring the body', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token('staff', 'branch-1', 'staff-1')}`)
      .send({ ...validBody, staffId: 'staff-2' });

    expect(res.status).toBe(201);
    const createArgs = prismaMock.order.create.mock.calls[0][0] as any;
    expect(createArgs.data.staffId).toBe('staff-1');
  });

  it('honors an explicit staffId from an admin caller', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token('admin', null, 'admin-1')}`)
      .send({ ...validBody, staffId: 'staff-2' });

    expect(res.status).toBe(201);
    const createArgs = prismaMock.order.create.mock.calls[0][0] as any;
    expect(createArgs.data.staffId).toBe('staff-2');
  });
});

describe('PATCH /:id/assign — admin-only staff (re)assignment', () => {
  it('rejects a staff-role token', async () => {
    const res = await request(app)
      .patch('/api/v1/orders/order-1/assign')
      .set('Authorization', `Bearer ${token('staff')}`)
      .send({ staffId: 'staff-2' });

    expect(res.status).toBe(403);
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });

  it('requires staffId in the body', async () => {
    const res = await request(app)
      .patch('/api/v1/orders/order-1/assign')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({});

    expect(res.status).toBe(400);
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });

  it('reassigns for a valid admin request', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'staff-2', role: 'staff', branchId: 'branch-1' } as any);
    prismaMock.order.findUnique.mockResolvedValue({ id: 'order-1', customer: { branchId: 'branch-1' } } as any);
    prismaMock.order.update.mockResolvedValue({ id: 'order-1', staffId: 'staff-2' } as any);

    const res = await request(app)
      .patch('/api/v1/orders/order-1/assign')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ staffId: 'staff-2' });

    expect(res.status).toBe(200);
    expect(res.body.order.staffId).toBe('staff-2');
  });
});
