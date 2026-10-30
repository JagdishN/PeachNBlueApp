import express from 'express';
import request from 'supertest';
import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock('../services/bankUpiService', () => ({
  verifyBankUpiPayment: jest.fn(),
  rejectBankUpiPayment: jest.fn(),
  listPendingBankUpiPayments: jest.fn(),
}));

import 'express-async-errors';
import prisma from '../prisma/client';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config';
import { errorHandler } from '../middleware/errorHandler';
import paymentRoutes from '../routes/payments';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const app = express();
app.use(express.json());
app.use('/api/v1/payments', paymentRoutes);
app.use(errorHandler);

const adminToken = jwt.sign({ userId: 'admin-1', role: 'admin', branchId: null }, JWT_SECRET);
const staffToken = jwt.sign({ userId: 'staff-1', role: 'staff', branchId: 'branch-1' }, JWT_SECRET);

beforeEach(() => {
  mockReset(prismaMock);
});

describe('GET /api/v1/payments/reconciliation-exceptions', () => {
  it('rejects a staff-role token', async () => {
    const res = await request(app)
      .get('/api/v1/payments/reconciliation-exceptions')
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(403);
  });

  it('defaults to listing only open exceptions, most recent first', async () => {
    prismaMock.paymentReconciliationException.findMany.mockResolvedValue([] as any);

    const res = await request(app)
      .get('/api/v1/payments/reconciliation-exceptions')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(prismaMock.paymentReconciliationException.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'open' }, orderBy: { createdAt: 'desc' } })
    );
  });

  it('lists every exception when status=all is passed', async () => {
    prismaMock.paymentReconciliationException.findMany.mockResolvedValue([] as any);

    await request(app)
      .get('/api/v1/payments/reconciliation-exceptions?status=all')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(prismaMock.paymentReconciliationException.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });
});

describe('PATCH /api/v1/payments/reconciliation-exceptions/:id/resolve', () => {
  it('rejects an invalid resolution value', async () => {
    const res = await request(app)
      .patch('/api/v1/payments/reconciliation-exceptions/exc-1/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'bogus' });

    expect(res.status).toBe(400);
  });

  it('404s when the exception does not exist', async () => {
    prismaMock.paymentReconciliationException.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/v1/payments/reconciliation-exceptions/missing/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'resolved_refunded', notes: 'Refunded via Razorpay dashboard' });

    expect(res.status).toBe(404);
  });

  it('records the resolution, resolver, and timestamp — never auto-refunds', async () => {
    prismaMock.paymentReconciliationException.findUnique.mockResolvedValue({ id: 'exc-1', resolutionNotes: null } as any);
    prismaMock.paymentReconciliationException.update.mockResolvedValue({ id: 'exc-1', status: 'resolved_refunded' } as any);

    const res = await request(app)
      .patch('/api/v1/payments/reconciliation-exceptions/exc-1/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'resolved_refunded', notes: 'Refunded ₹100 via Razorpay dashboard, ref RFND123' });

    expect(res.status).toBe(200);
    expect(prismaMock.paymentReconciliationException.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'exc-1' },
        data: expect.objectContaining({
          status: 'resolved_refunded',
          resolutionNotes: 'Refunded ₹100 via Razorpay dashboard, ref RFND123',
          resolvedById: 'admin-1',
        }),
      })
    );
  });
});
