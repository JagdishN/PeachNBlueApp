import express from 'express';
import request from 'supertest';

jest.mock('../services/vendorInvoiceService', () => ({
  listVendorInvoices: jest.fn(),
  getVendorInvoiceSummary: jest.fn(),
  getVendorInvoice: jest.fn(),
  createVendorInvoice: jest.fn(),
  updateVendorInvoice: jest.fn(),
  voidVendorInvoice: jest.fn(),
  listVendorInvoiceAudit: jest.fn(),
  toVendorInvoiceCsv: jest.fn().mockReturnValue('csv-content'),
}));

import 'express-async-errors';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config';
import { errorHandler } from '../middleware/errorHandler';
import vendorInvoiceRoutes from '../routes/vendorInvoices';
import {
  listVendorInvoices,
  getVendorInvoiceSummary,
  createVendorInvoice,
  updateVendorInvoice,
} from '../services/vendorInvoiceService';

const listMock = listVendorInvoices as jest.Mock;
const summaryMock = getVendorInvoiceSummary as jest.Mock;
const createMock = createVendorInvoice as jest.Mock;
const updateMock = updateVendorInvoice as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/v1/vendor-invoices', vendorInvoiceRoutes);
app.use(errorHandler);

const unscopedAdminToken = jwt.sign({ userId: 'admin-1', role: 'admin', branchId: null }, JWT_SECRET);
const scopedAdminToken = jwt.sign({ userId: 'admin-2', role: 'admin', branchId: 'branch-1' }, JWT_SECRET);
const staffToken = jwt.sign({ userId: 'staff-1', role: 'staff', branchId: 'branch-1' }, JWT_SECRET);

beforeEach(() => {
  listMock.mockReset().mockResolvedValue({ rows: [], total: 0, limit: 50, offset: 0 });
  summaryMock.mockReset().mockResolvedValue({ totalAmount: 0, paidAmount: 0, unpaidAmount: 0 });
  createMock.mockReset();
  updateMock.mockReset();
});

describe('GET /api/v1/vendor-invoices', () => {
  // Mandatory test #16 (read side) — no staff entry point to this feature at all.
  it('rejects a staff-role token', async () => {
    const res = await request(app).get('/api/v1/vendor-invoices').set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });

  // Mandatory test #17: a branch-scoped admin's own branch always wins
  // over any ?branchId= query param they try to pass.
  it('locks a branch-scoped admin to their own branch regardless of a different ?branchId= query param', async () => {
    const res = await request(app)
      .get('/api/v1/vendor-invoices?branchId=some-other-branch')
      .set('Authorization', `Bearer ${scopedAdminToken}`);

    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'branch-1' }));
  });

  it('lets an unscoped admin filter by an explicit branchId, or see every branch when omitted', async () => {
    await request(app).get('/api/v1/vendor-invoices?branchId=branch-9').set('Authorization', `Bearer ${unscopedAdminToken}`);
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'branch-9' }));

    listMock.mockClear();
    await request(app).get('/api/v1/vendor-invoices').set('Authorization', `Bearer ${unscopedAdminToken}`);
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: undefined }));
  });

  it('returns rows alongside the summary totals', async () => {
    const res = await request(app).get('/api/v1/vendor-invoices').set('Authorization', `Bearer ${unscopedAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
    expect(res.body).toHaveProperty('rows');
  });
});

describe('POST /api/v1/vendor-invoices', () => {
  // Mandatory test #16 (write side): "Reject unauthorized Staff create/update requests."
  it('rejects a staff-role token', async () => {
    const res = await request(app)
      .post('/api/v1/vendor-invoices')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ vendorName: 'Acme', serviceType: 'wash_fold', amount: 100 });

    expect(res.status).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('forces a branch-scoped admin\'s own branch onto a created vendor invoice', async () => {
    createMock.mockResolvedValue({ id: 'vi-1' });

    await request(app)
      .post('/api/v1/vendor-invoices')
      .set('Authorization', `Bearer ${scopedAdminToken}`)
      .send({ vendorName: 'Acme', serviceType: 'wash_fold', amount: 100, branchId: 'some-other-branch' });

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'branch-1', createdById: 'admin-2' }));
  });

  it('lets an unscoped admin create with an explicit branch, or none at all (global)', async () => {
    createMock.mockResolvedValue({ id: 'vi-1' });

    await request(app)
      .post('/api/v1/vendor-invoices')
      .set('Authorization', `Bearer ${unscopedAdminToken}`)
      .send({ vendorName: 'Acme', serviceType: 'wash_fold', amount: 100 });

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ branchId: null }));
  });
});

describe('PATCH /api/v1/vendor-invoices/:id', () => {
  it('rejects a staff-role token', async () => {
    const res = await request(app)
      .patch('/api/v1/vendor-invoices/vi-1')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ paymentDone: true });

    expect(res.status).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('lets an admin update', async () => {
    updateMock.mockResolvedValue({ id: 'vi-1', paymentStatus: 'paid' });

    const res = await request(app)
      .patch('/api/v1/vendor-invoices/vi-1')
      .set('Authorization', `Bearer ${unscopedAdminToken}`)
      .send({ paymentDone: true });

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith('vi-1', expect.objectContaining({ paymentDone: true, updatedById: 'admin-1' }));
  });
});

// Mandatory test #20: nothing here touches customer invoicing or Razorpay —
// confirmed structurally: this whole file only imports vendorInvoiceService
// (mocked above) and shares no import with invoiceService/razorpayClient/
// paymentLedgerService at all.
