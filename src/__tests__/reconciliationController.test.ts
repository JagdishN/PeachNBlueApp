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
  prismaMock.$transaction.mockImplementation(((cb: any) => cb(prismaMock)) as any);
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

  it('does not query payments at all when no exception has any relatedPaymentIds', async () => {
    prismaMock.paymentReconciliationException.findMany.mockResolvedValue([
      { id: 'exc-1', relatedPaymentIds: [] },
    ] as any);

    await request(app).get('/api/v1/payments/reconciliation-exceptions').set('Authorization', `Bearer ${adminToken}`);

    expect(prismaMock.payment.findMany).not.toHaveBeenCalled();
  });

  // Reconciliation-screen audit (2026-10-31) — relatedPaymentIds are our own
  // internal Payment.id values, not Razorpay's own id. An admin reviewing
  // this list needs the REAL Razorpay Payment ID to cross-check against the
  // Razorpay dashboard, so each exception must be enriched with the actual
  // payment rows those ids point to.
  it('enriches each exception with the real Razorpay Payment ID(s) behind its relatedPaymentIds', async () => {
    prismaMock.paymentReconciliationException.findMany.mockResolvedValue([
      { id: 'exc-1', relatedPaymentIds: ['payment-1', 'payment-2'] },
    ] as any);
    prismaMock.payment.findMany.mockResolvedValue([
      { id: 'payment-1', razorpayPaymentId: 'pay_abc', amountPaise: 50000n, paymentMethod: 'credit_card', paymentSource: 'razorpay' },
      { id: 'payment-2', razorpayPaymentId: null, amountPaise: 30000n, paymentMethod: 'cash', paymentSource: 'cash' },
    ] as any);

    const res = await request(app)
      .get('/api/v1/payments/reconciliation-exceptions')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(prismaMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['payment-1', 'payment-2'] } } })
    );
    expect(res.body.exceptions[0].relatedPayments).toHaveLength(2);
    expect(res.body.exceptions[0].relatedPayments[0].razorpayPaymentId).toBe('pay_abc');
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

  // Payment collection / customer advances rework, Phase 3 Option C — the
  // one resolution/exceptionType combination that actually moves money.
  it('converts an unapplied_cash_pending_review exception to a real CustomerCredit when resolved as resolved_credited', async () => {
    prismaMock.paymentReconciliationException.findUnique.mockResolvedValue({
      id: 'exc-1',
      status: 'open',
      exceptionType: 'unapplied_cash_pending_review',
      customerId: 'customer-1',
      excessPaise: 10000n,
      resolutionNotes: null,
    } as any);
    prismaMock.paymentReconciliationException.update.mockResolvedValue({ id: 'exc-1', status: 'resolved_credited' } as any);

    const res = await request(app)
      .patch('/api/v1/payments/reconciliation-exceptions/exc-1/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'resolved_credited', notes: 'Customer agreed to keep as advance' });

    expect(res.status).toBe(200);
    expect(prismaMock.customerCredit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'customer-1',
          transactionType: 'issued',
          amountPaise: 10000n,
          resolvedExceptionId: 'exc-1',
          createdById: 'admin-1',
        }),
      })
    );
  });

  it('rejects resolving the same unapplied_cash_pending_review exception as resolved_credited twice (no second advance)', async () => {
    prismaMock.paymentReconciliationException.findUnique.mockResolvedValue({
      id: 'exc-1',
      status: 'resolved_credited', // already resolved
      exceptionType: 'unapplied_cash_pending_review',
      customerId: 'customer-1',
      excessPaise: 10000n,
    } as any);

    const res = await request(app)
      .patch('/api/v1/payments/reconciliation-exceptions/exc-1/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'resolved_credited', notes: 'retry' });

    expect(res.status).toBe(409);
    expect(prismaMock.customerCredit.create).not.toHaveBeenCalled();
  });

  it('does NOT create a CustomerCredit for resolved_credited on any OTHER exceptionType (stays purely declarative)', async () => {
    prismaMock.paymentReconciliationException.findUnique.mockResolvedValue({
      id: 'exc-2',
      status: 'open',
      exceptionType: 'overpayment',
      customerId: 'customer-1',
      excessPaise: 5000n,
      resolutionNotes: null,
    } as any);
    prismaMock.paymentReconciliationException.update.mockResolvedValue({ id: 'exc-2', status: 'resolved_credited' } as any);

    const res = await request(app)
      .patch('/api/v1/payments/reconciliation-exceptions/exc-2/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'resolved_credited', notes: 'noted' });

    expect(res.status).toBe(200);
    expect(prismaMock.customerCredit.create).not.toHaveBeenCalled();
  });
});

// Webhook historical-link resolution fix — admin visibility for a verified
// Razorpay receipt the webhook couldn't tie to any invoice (spec: "make the
// exception visible through the existing admin reconciliation workflow").
describe('GET /api/v1/payments/unmatched-provider-payments', () => {
  it('rejects a staff-role token', async () => {
    const res = await request(app)
      .get('/api/v1/payments/unmatched-provider-payments')
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(403);
  });

  it('defaults to listing only unresolved rows, most recent first', async () => {
    prismaMock.unmatchedProviderPayment.findMany.mockResolvedValue([] as any);

    const res = await request(app)
      .get('/api/v1/payments/unmatched-provider-payments')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(prismaMock.unmatchedProviderPayment.findMany).toHaveBeenCalledWith({
      where: { status: 'unresolved' },
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('PATCH /api/v1/payments/unmatched-provider-payments/:id/resolve', () => {
  it('rejects an invalid resolution value', async () => {
    const res = await request(app)
      .patch('/api/v1/payments/unmatched-provider-payments/u-1/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'bogus' });

    expect(res.status).toBe(400);
  });

  it('404s when the row does not exist', async () => {
    prismaMock.unmatchedProviderPayment.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/v1/payments/unmatched-provider-payments/missing/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'resolved', notes: 'Matched manually' });

    expect(res.status).toBe(404);
  });

  it('records the resolution, resolver, and timestamp', async () => {
    prismaMock.unmatchedProviderPayment.findUnique.mockResolvedValue({ id: 'u-1', resolutionNotes: null } as any);
    prismaMock.unmatchedProviderPayment.update.mockResolvedValue({ id: 'u-1', status: 'resolved' } as any);

    const res = await request(app)
      .patch('/api/v1/payments/unmatched-provider-payments/u-1/resolve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'resolved', notes: 'Matched manually to order #123' });

    expect(res.status).toBe(200);
    expect(prismaMock.unmatchedProviderPayment.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: expect.objectContaining({
        status: 'resolved',
        resolutionNotes: 'Matched manually to order #123',
        resolvedById: 'admin-1',
      }),
    });
  });
});
