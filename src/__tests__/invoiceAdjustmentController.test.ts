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
jest.mock('../services/invoiceAdjustmentService', () => ({
  closeOutstandingBalance: jest.fn(),
  reverseAdjustment: jest.fn(),
  listAdjustmentsForInvoice: jest.fn(),
}));

import 'express-async-errors';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config';
import { errorHandler } from '../middleware/errorHandler';
import paymentRoutes from '../routes/payments';
import { closeOutstandingBalance, reverseAdjustment, listAdjustmentsForInvoice } from '../services/invoiceAdjustmentService';

const closeOutstandingBalanceMock = closeOutstandingBalance as jest.Mock;
const reverseAdjustmentMock = reverseAdjustment as jest.Mock;
const listAdjustmentsForInvoiceMock = listAdjustmentsForInvoice as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/v1/payments', paymentRoutes);
app.use(errorHandler);

const adminToken = jwt.sign({ userId: 'admin-1', role: 'admin', branchId: null }, JWT_SECRET);
const staffToken = jwt.sign({ userId: 'staff-1', role: 'staff', branchId: 'branch-1' }, JWT_SECRET);

beforeEach(() => {
  closeOutstandingBalanceMock.mockReset();
  reverseAdjustmentMock.mockReset();
  listAdjustmentsForInvoiceMock.mockReset();
});

describe('GET /api/v1/payments/invoices/:invoiceId/adjustments', () => {
  it('rejects a staff-role token', async () => {
    const res = await request(app).get('/api/v1/payments/invoices/inv-1/adjustments').set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  // Regression: the raw row's amountPaise must be converted to a plain
  // rupee `amount` (consistent with every other amount this API returns),
  // never left as a bare paise integer on the wire.
  it('converts each row\'s amountPaise to a rupee amount', async () => {
    listAdjustmentsForInvoiceMock.mockResolvedValue([
      { id: 'adj-1', invoiceId: 'inv-1', amountPaise: 10000n, reasonCategory: 'goodwill', reason: 'x', createdAt: new Date(), reversedAt: null },
    ]);

    const res = await request(app).get('/api/v1/payments/invoices/inv-1/adjustments').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.adjustments[0].amount).toBe(100);
    expect(res.body.adjustments[0]).not.toHaveProperty('amountPaise');
  });
});

describe('POST /api/v1/payments/invoices/:invoiceId/close-outstanding', () => {
  // Mandatory test #2: staff cannot access the closure API — enforced at
  // the route layer, same requireRole(['admin']) gate as every other
  // handler on this router.
  it('rejects a staff-role token outright, before the service is ever called', async () => {
    const res = await request(app)
      .post('/api/v1/payments/invoices/inv-1/close-outstanding')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ reasonCategory: 'goodwill', reason: 'Customer goodwill' });

    expect(res.status).toBe(403);
    expect(closeOutstandingBalanceMock).not.toHaveBeenCalled();
  });

  it('400s when reasonCategory or reason is missing from the body', async () => {
    const res = await request(app)
      .post('/api/v1/payments/invoices/inv-1/close-outstanding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(closeOutstandingBalanceMock).not.toHaveBeenCalled();
  });

  it('lets an admin close the balance and forwards the idempotency key', async () => {
    closeOutstandingBalanceMock.mockResolvedValue({
      adjustmentId: 'adj-1',
      waivedAmount: 100,
      outstandingBefore: 100,
      outstandingAfter: 0,
      linkLifecycle: 'not_applicable',
    });

    const res = await request(app)
      .post('/api/v1/payments/invoices/inv-1/close-outstanding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reasonCategory: 'goodwill', reason: 'Customer goodwill', idempotencyKey: 'key-1' });

    expect(res.status).toBe(200);
    expect(res.body.outstandingAfter).toBe(0);
    expect(closeOutstandingBalanceMock).toHaveBeenCalledWith({
      invoiceId: 'inv-1',
      adminId: 'admin-1',
      reasonCategory: 'goodwill',
      reason: 'Customer goodwill',
      idempotencyKey: 'key-1',
    });
  });

  it('propagates a thrown PENDING_VERIFICATION error as a 409 with its code intact', async () => {
    const err = new Error('A payment on this invoice is still awaiting verification.') as Error & { status?: number; code?: string };
    err.status = 409;
    err.code = 'PENDING_VERIFICATION';
    closeOutstandingBalanceMock.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/v1/payments/invoices/inv-1/close-outstanding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reasonCategory: 'goodwill', reason: 'Customer goodwill' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PENDING_VERIFICATION');
  });
});

describe('POST /api/v1/payments/invoices/:invoiceId/adjustments/:adjustmentId/reverse', () => {
  it('rejects a staff-role token', async () => {
    const res = await request(app)
      .post('/api/v1/payments/invoices/inv-1/adjustments/adj-1/reverse')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ reversalReason: 'Wrong invoice' });

    expect(res.status).toBe(403);
    expect(reverseAdjustmentMock).not.toHaveBeenCalled();
  });

  it('lets an admin reverse an adjustment', async () => {
    reverseAdjustmentMock.mockResolvedValue({
      adjustmentId: 'adj-1',
      outstandingBefore: 0,
      outstandingAfter: 100,
      linkLifecycle: 'completed',
    });

    const res = await request(app)
      .post('/api/v1/payments/invoices/inv-1/adjustments/adj-1/reverse')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reversalReason: 'Closed the wrong invoice' });

    expect(res.status).toBe(200);
    expect(res.body.outstandingAfter).toBe(100);
    expect(reverseAdjustmentMock).toHaveBeenCalledWith({
      invoiceId: 'inv-1',
      adjustmentId: 'adj-1',
      adminId: 'admin-1',
      reversalReason: 'Closed the wrong invoice',
    });
  });
});
