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
jest.mock('../services/invoiceReissue.service', () => ({
  reissueAllOpenInvoicesForCustomer: jest.fn().mockResolvedValue(undefined),
  reissueInvoice: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../config', () => ({ JWT_SECRET: 'test-secret-key' }));

import prisma from '../prisma/client';
import { errorHandler } from '../middleware/errorHandler';
import { JWT_SECRET } from '../config';
import customerRoutes from '../routes/customers';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const app = express();
app.use(express.json());
app.use('/api/v1/customers', customerRoutes);
app.use(errorHandler);

const adminToken = jwt.sign({ userId: 'admin-1', role: 'admin', branchId: null }, JWT_SECRET);
const staffToken = jwt.sign({ userId: 'staff-1', role: 'staff', branchId: 'branch-1' }, JWT_SECRET);

beforeEach(() => {
  mockReset(prismaMock);
  prismaMock.$transaction.mockImplementation(((cb: any) => cb(prismaMock)) as any);
  prismaMock.customerCredit.findMany.mockResolvedValue([]);
});

describe('GET /api/v1/customers/:id/credit-balance', () => {
  it('is reachable by staff AND admin (Phase 7: visible to Admin and authorized Staff)', async () => {
    const staffRes = await request(app)
      .get('/api/v1/customers/c-1/credit-balance')
      .set('Authorization', `Bearer ${staffToken}`);
    const adminRes = await request(app)
      .get('/api/v1/customers/c-1/credit-balance')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(staffRes.status).toBe(200);
    expect(adminRes.status).toBe(200);
  });
});

describe('GET /api/v1/customers/:id/credit-history', () => {
  it('is reachable by staff AND admin', async () => {
    const res = await request(app)
      .get('/api/v1/customers/c-1/credit-history')
      .set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/customers/:id/credit-refund', () => {
  it('rejects a staff-role token (Admin-only financial action)', async () => {
    const res = await request(app)
      .post('/api/v1/customers/c-1/credit-refund')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ amount: 50, reason: 'Customer asked for cash back' });

    expect(res.status).toBe(403);
  });

  it('rejects a missing/non-positive amount', async () => {
    const res = await request(app)
      .post('/api/v1/customers/c-1/credit-refund')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 0, reason: 'x' });

    expect(res.status).toBe(400);
  });

  it('rejects a missing reason', async () => {
    const res = await request(app)
      .post('/api/v1/customers/c-1/credit-refund')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 50 });

    expect(res.status).toBe(400);
  });

  it('rejects refunding more than the available balance', async () => {
    prismaMock.customerCredit.findMany.mockResolvedValue([{ transactionType: 'issued', amountPaise: 2000n, reversalOf: null }] as any);

    const res = await request(app)
      .post('/api/v1/customers/c-1/credit-refund')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 100, reason: 'Customer asked for cash back' });

    expect(res.status).toBe(400);
  });

  it('records a real refund transaction when admin and within balance', async () => {
    prismaMock.customerCredit.findMany.mockResolvedValue([{ transactionType: 'issued', amountPaise: 10000n, reversalOf: null }] as any);
    prismaMock.customerCredit.create.mockResolvedValue({ id: 'ct-1', transactionType: 'refunded' } as any);

    const res = await request(app)
      .post('/api/v1/customers/c-1/credit-refund')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 50, reason: 'Customer asked for cash back' });

    expect(res.status).toBe(200);
    expect(prismaMock.customerCredit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ transactionType: 'refunded', amountPaise: 5000n, reason: 'Customer asked for cash back' }) })
    );
  });
});

describe("POST /api/v1/customers/:id/credit-transactions/:transactionId/reverse", () => {
  it('rejects a staff-role token', async () => {
    const res = await request(app)
      .post('/api/v1/customers/c-1/credit-transactions/t-1/reverse')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ reason: 'mistake' });

    expect(res.status).toBe(403);
  });

  it('rejects a missing reason', async () => {
    const res = await request(app)
      .post('/api/v1/customers/c-1/credit-transactions/t-1/reverse')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('404s when the transaction does not exist', async () => {
    prismaMock.customerCredit.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/customers/c-1/credit-transactions/missing/reverse')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'mistake' });

    expect(res.status).toBe(404);
  });

  it('reverses a valid transaction as admin', async () => {
    prismaMock.customerCredit.findUnique.mockResolvedValue({ id: 't-1', transactionType: 'issued', customerId: 'c-1', amountPaise: 5000n } as any);
    prismaMock.customerCredit.findFirst.mockResolvedValue(null);
    prismaMock.customerCredit.create.mockResolvedValue({ id: 't-2', transactionType: 'reversed' } as any);

    const res = await request(app)
      .post('/api/v1/customers/c-1/credit-transactions/t-1/reverse')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Closed the wrong invoice' });

    expect(res.status).toBe(200);
  });
});
