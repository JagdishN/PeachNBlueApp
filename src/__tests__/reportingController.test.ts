import 'express-async-errors';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config';
import { errorHandler } from '../middleware/errorHandler';
import reportRoutes from '../routes/reports';
import customerRoutes from '../routes/customers';

jest.mock('../services/reportingService', () => ({
  getInvoiceAgingReport: jest.fn(),
  getCustomerStatement: jest.fn(),
  toAgingCsv: jest.fn(() => 'Branch,Customer\nAttapur,Test'),
}));
jest.mock('../services/ledgerService', () => ({ getAgingReport: jest.fn().mockResolvedValue([]) }));
jest.mock('../services/outstandingService', () => ({ getCustomerOutstandingSummary: jest.fn(), recordCustomerPayment: jest.fn() }));
jest.mock('../services/reminderService', () => ({ sendPaymentReminder: jest.fn(), listReminderHistory: jest.fn() }));
jest.mock('../prisma/client', () => ({ __esModule: true, default: {} }));
jest.mock('../services/invoiceReissue.service', () => ({ reissueAllOpenInvoicesForCustomer: jest.fn() }));

import { getInvoiceAgingReport, getCustomerStatement } from '../services/reportingService';

const getAgingMock = getInvoiceAgingReport as jest.Mock;
const getStatementMock = getCustomerStatement as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use(errorHandler);

const staffToken = jwt.sign({ userId: 'staff-1', role: 'staff', branchId: 'branch-1' }, JWT_SECRET);
const adminToken = jwt.sign({ userId: 'admin-1', role: 'admin', branchId: null }, JWT_SECRET);

beforeEach(() => {
  getAgingMock.mockReset();
  getStatementMock.mockReset();
});

describe('GET /api/v1/reports/aging', () => {
  it('rejects a staff-role token', async () => {
    const res = await request(app).get('/api/v1/reports/aging').set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it('returns the aging rows for an admin', async () => {
    getAgingMock.mockResolvedValue([{ invoiceId: 'inv-1' }]);
    const res = await request(app).get('/api/v1/reports/aging').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([{ invoiceId: 'inv-1' }]);
  });
});

describe('GET /api/v1/reports/aging.csv', () => {
  it('returns a CSV content-type and attachment header for an admin', async () => {
    getAgingMock.mockResolvedValue([]);
    const res = await request(app).get('/api/v1/reports/aging.csv').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
  });
});

describe('GET /api/v1/customers/:id/statement', () => {
  it('rejects a staff-role token', async () => {
    const res = await request(app).get('/api/v1/customers/customer-1/statement').set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it('returns the statement for an admin', async () => {
    getStatementMock.mockResolvedValue({ customerId: 'customer-1', entries: [], closingBalance: 0 });
    const res = await request(app).get('/api/v1/customers/customer-1/statement').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.statement.closingBalance).toBe(0);
  });
});
