import 'express-async-errors';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config';
import { errorHandler } from '../middleware/errorHandler';
import customerRoutes from '../routes/customers';

jest.mock('../services/outstandingService', () => ({
  getCustomerOutstandingSummary: jest.fn(),
  recordCustomerPayment: jest.fn(),
}));
// customerController.ts's handlers aren't under test here, but the route
// file imports them, which transitively pulls in supabaseStorage.ts's ESM
// @supabase/server import — Jest can't transform that. Same workaround
// customerController.test.ts itself already uses: mock invoiceReissue
// .service (the thing that actually imports supabaseStorage) directly.
jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../services/invoiceReissue.service', () => ({
  reissueAllOpenInvoicesForCustomer: jest.fn(),
}));

import { getCustomerOutstandingSummary, recordCustomerPayment } from '../services/outstandingService';

const getSummaryMock = getCustomerOutstandingSummary as jest.Mock;
const recordPaymentMock = recordCustomerPayment as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/v1/customers', customerRoutes);
app.use(errorHandler);

const staffToken = jwt.sign({ userId: 'staff-1', role: 'staff', branchId: 'branch-1' }, JWT_SECRET);
const adminToken = jwt.sign({ userId: 'admin-1', role: 'admin', branchId: null }, JWT_SECRET);

beforeEach(() => {
  getSummaryMock.mockReset();
  recordPaymentMock.mockReset();
});

describe('GET /api/v1/customers/:id/outstanding', () => {
  it('is reachable by staff, not just admin', async () => {
    getSummaryMock.mockResolvedValue({ customerId: 'customer-1', invoices: [], totalOutstanding: 0, totalCollected: 0, totalOriginal: 0 });

    const res = await request(app)
      .get('/api/v1/customers/customer-1/outstanding')
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(getSummaryMock).toHaveBeenCalledWith('customer-1');
  });
});

describe('POST /api/v1/customers/:id/payments', () => {
  it('rejects a missing/invalid amount', async () => {
    const res = await request(app)
      .post('/api/v1/customers/customer-1/payments')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ amount: -5 });

    expect(res.status).toBe(400);
    expect(recordPaymentMock).not.toHaveBeenCalled();
  });

  it('records a cash payment against the customer and returns the allocation breakdown', async () => {
    recordPaymentMock.mockResolvedValue({
      paymentId: 'payment-1',
      totalAllocatedPaise: 20000n,
      excessPaise: 0n,
      touchedInvoices: [{ invoiceId: 'inv-1', allocatedPaise: 20000n }],
    });

    const res = await request(app)
      .post('/api/v1/customers/customer-1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 200, idempotencyKey: 'idem-1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      paymentId: 'payment-1',
      totalAllocated: 200,
      excess: 0,
      touchedInvoices: [{ invoiceId: 'inv-1', allocated: 200 }],
    });
    expect(recordPaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'customer-1', grossAmount: 200, paymentSource: 'cash', recordedById: 'admin-1' })
    );
  });
});
