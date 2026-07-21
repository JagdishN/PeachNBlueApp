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
}));
// This repo's local .env has JWT_SECRET='' (empty) for this dev environment,
// which config/index.ts doesn't fall back away from (a pre-existing gap
// unrelated to this feature) — jwt.sign() rejects an empty secret outright,
// so tests need their own non-empty value rather than depending on the
// real env. Mocked here rather than fixed in config/index.ts to keep this
// change scoped to the test.
jest.mock('../config', () => ({ JWT_SECRET: 'test-secret-key' }));

import prisma from '../prisma/client';
import { reissueAllOpenInvoicesForCustomer } from '../services/invoiceReissue.service';
import { errorHandler } from '../middleware/errorHandler';
import { JWT_SECRET } from '../config';
import customerRoutes from '../routes/customers';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const reissueAllOpenInvoicesForCustomerMock = reissueAllOpenInvoicesForCustomer as jest.Mock;

// Minimal app mirroring server.ts's mounting of customerRoutes, without the
// staffFieldFilter/helmet/cors noise that isn't relevant to these tests.
const app = express();
app.use(express.json());
app.use('/api/v1/customers', customerRoutes);
app.use(errorHandler);

const token = (role: 'staff' | 'admin', branchId: string | null = null) =>
  jwt.sign({ userId: 'user-1', role, branchId }, JWT_SECRET);

beforeEach(() => {
  mockReset(prismaMock);
  reissueAllOpenInvoicesForCustomerMock.mockReset();
  reissueAllOpenInvoicesForCustomerMock.mockResolvedValue(undefined);
});

describe('GET / — admin-only list, branch-scoped like listBranchesHandler', () => {
  it('rejects a staff-role token', async () => {
    const res = await request(app).get('/api/v1/customers').set('Authorization', `Bearer ${token('staff')}`);

    expect(res.status).toBe(403);
    expect(prismaMock.customer.findMany).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/customers');

    expect(res.status).toBe(401);
  });

  it('an unscoped admin with no branchId query param sees every branch', async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/v1/customers').set('Authorization', `Bearer ${token('admin')}`);

    expect(res.status).toBe(200);
    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined })
    );
  });

  it('an unscoped admin can narrow the list with a branchId query param', async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/v1/customers?branchId=branch-2')
      .set('Authorization', `Bearer ${token('admin')}`);

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { branchId: 'branch-2' } })
    );
  });

  it("a branch-scoped admin's own branchId wins over any query param", async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/v1/customers?branchId=some-other-branch')
      .set('Authorization', `Bearer ${token('admin', 'branch-1')}`);

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { branchId: 'branch-1' } })
    );
  });

  it('includes the branch name so the mobile screen can group/section by branch', async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);

    await request(app).get('/api/v1/customers').set('Authorization', `Bearer ${token('admin')}`);

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: { branch: { select: { branchName: true } } } })
    );
  });
});

describe('POST / — customer create/lookup, staff AND admin (CLAUDE.md "Customer creation")', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/v1/customers').send({});

    expect(res.status).toBe(401);
  });

  it('allows a staff-role token (unlike the admin-only endpoints above)', async () => {
    prismaMock.customer.upsert.mockResolvedValue({ id: 'customer-1' } as any);

    const res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token('staff', 'branch-1')}`)
      .send({ fullName: 'Priya Menon', phoneNumber: '9999999999', locationLabel: 'A-101' });

    expect(res.status).toBe(200);
    expect(prismaMock.customer.upsert).toHaveBeenCalled();
  });

  it('rejects missing required fields', async () => {
    const res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token('staff', 'branch-1')}`)
      .send({ fullName: 'Priya Menon' });

    expect(res.status).toBe(400);
    expect(prismaMock.customer.upsert).not.toHaveBeenCalled();
  });

  it("locks a staff caller to their own branchId, ignoring any branchId in the body", async () => {
    prismaMock.customer.upsert.mockResolvedValue({ id: 'customer-1' } as any);

    await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token('staff', 'branch-1')}`)
      .send({ fullName: 'Priya Menon', phoneNumber: '9999999999', locationLabel: 'A-101', branchId: 'branch-2' });

    expect(prismaMock.customer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          phoneNumber_branchId_locationLabel: {
            phoneNumber: '9999999999',
            branchId: 'branch-1',
            locationLabel: 'A-101',
          },
        },
      })
    );
  });

  it('requires an explicit branchId from an unscoped admin', async () => {
    const res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ fullName: 'Priya Menon', phoneNumber: '9999999999', locationLabel: 'A-101' });

    expect(res.status).toBe(400);
    expect(prismaMock.customer.upsert).not.toHaveBeenCalled();
  });

  it('never selects discountPercent/discountEnabled for a staff caller (primary defense)', async () => {
    prismaMock.customer.upsert.mockResolvedValue({ id: 'customer-1' } as any);

    await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token('staff', 'branch-1')}`)
      .send({ fullName: 'Priya Menon', phoneNumber: '9999999999', locationLabel: 'A-101' });

    const upsertArgs = prismaMock.customer.upsert.mock.calls[0][0] as any;
    expect(upsertArgs.select).not.toHaveProperty('discountPercent');
    expect(upsertArgs.select).not.toHaveProperty('discountEnabled');
  });
});

describe('GET /search — phone lookup, staff AND admin', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/customers/search?phone=9999999999');

    expect(res.status).toBe(401);
  });

  it('requires a phone query parameter', async () => {
    const res = await request(app)
      .get('/api/v1/customers/search')
      .set('Authorization', `Bearer ${token('staff', 'branch-1')}`);

    expect(res.status).toBe(400);
    expect(prismaMock.customer.findMany).not.toHaveBeenCalled();
  });

  it("scopes a staff caller's search to their own branch", async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/v1/customers/search?phone=9999999999')
      .set('Authorization', `Bearer ${token('staff', 'branch-1')}`);

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phoneNumber: '9999999999', branchId: 'branch-1' } })
    );
  });

  it('lets an unscoped admin search across every branch', async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/v1/customers/search?phone=9999999999')
      .set('Authorization', `Bearer ${token('admin')}`);

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phoneNumber: '9999999999' } })
    );
  });
});

describe('PATCH /:id/billing-mode — admin-only write, staff can still read billingMode elsewhere', () => {
  it('rejects a staff-role token (role-gate check)', async () => {
    const res = await request(app)
      .patch('/api/v1/customers/customer-1/billing-mode')
      .set('Authorization', `Bearer ${token('staff')}`)
      .send({ billingMode: 'monthly_billing' });

    expect(res.status).toBe(403);
    expect(prismaMock.customer.update).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app)
      .patch('/api/v1/customers/customer-1/billing-mode')
      .send({ billingMode: 'monthly_billing' });

    expect(res.status).toBe(401);
  });

  it('allows an admin-role token to change billingMode', async () => {
    prismaMock.customer.findUnique.mockResolvedValue({ id: 'customer-1' } as any);
    prismaMock.customer.update.mockResolvedValue({ id: 'customer-1', billingMode: 'monthly_billing' } as any);

    const res = await request(app)
      .patch('/api/v1/customers/customer-1/billing-mode')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ billingMode: 'monthly_billing' });

    expect(res.status).toBe(200);
    expect(prismaMock.customer.update).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      data: { billingMode: 'monthly_billing' },
    });
  });

  it('rejects an invalid billingMode value even for an admin', async () => {
    const res = await request(app)
      .patch('/api/v1/customers/customer-1/billing-mode')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ billingMode: 'weekly' });

    expect(res.status).toBe(400);
    expect(prismaMock.customer.update).not.toHaveBeenCalled();
  });

  it('does not reissue invoices on a billingMode change (unrelated to payable amount)', async () => {
    prismaMock.customer.findUnique.mockResolvedValue({ id: 'customer-1' } as any);
    prismaMock.customer.update.mockResolvedValue({ id: 'customer-1', billingMode: 'daily' } as any);

    await request(app)
      .patch('/api/v1/customers/customer-1/billing-mode')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ billingMode: 'daily' });

    expect(reissueAllOpenInvoicesForCustomerMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /:id/discount-enabled — fully admin-only, same treatment as discountPercent', () => {
  it('rejects a staff-role token', async () => {
    const res = await request(app)
      .patch('/api/v1/customers/customer-1/discount-enabled')
      .set('Authorization', `Bearer ${token('staff')}`)
      .send({ discountEnabled: true });

    expect(res.status).toBe(403);
    expect(prismaMock.customer.update).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean value', async () => {
    const res = await request(app)
      .patch('/api/v1/customers/customer-1/discount-enabled')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ discountEnabled: 'yes' });

    expect(res.status).toBe(400);
  });

  it('updates discountEnabled and reissues open invoices for an admin', async () => {
    prismaMock.customer.findUnique.mockResolvedValue({ id: 'customer-1' } as any);
    prismaMock.customer.update.mockResolvedValue({ id: 'customer-1', discountEnabled: true } as any);

    const res = await request(app)
      .patch('/api/v1/customers/customer-1/discount-enabled')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ discountEnabled: true });

    expect(res.status).toBe(200);
    expect(prismaMock.customer.update).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      data: { discountEnabled: true },
    });
    expect(reissueAllOpenInvoicesForCustomerMock).toHaveBeenCalledWith('customer-1');
  });

  it('reissues open invoices when disabling too (payable amount goes back up)', async () => {
    prismaMock.customer.findUnique.mockResolvedValue({ id: 'customer-1' } as any);
    prismaMock.customer.update.mockResolvedValue({ id: 'customer-1', discountEnabled: false } as any);

    await request(app)
      .patch('/api/v1/customers/customer-1/discount-enabled')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ discountEnabled: false });

    expect(reissueAllOpenInvoicesForCustomerMock).toHaveBeenCalledWith('customer-1');
  });

  it('returns 404 for a customer that does not exist', async () => {
    prismaMock.customer.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/v1/customers/missing-customer/discount-enabled')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ discountEnabled: true });

    expect(res.status).toBe(404);
    expect(prismaMock.customer.update).not.toHaveBeenCalled();
  });
});

// CLAUDE.md "Laundry bag tracking" — free bag issued once per customer,
// ₹350 AdditionalCharge if subsequently lost/damaged.
describe('PATCH /:id/bag-issued — staff AND admin, idempotent', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).patch('/api/v1/customers/customer-1/bag-issued');

    expect(res.status).toBe(401);
  });

  it('allows a staff-role token', async () => {
    prismaMock.customer.findUnique.mockResolvedValue({ id: 'customer-1', bagIssued: false } as any);
    prismaMock.customer.update.mockResolvedValue({ id: 'customer-1', bagIssued: true } as any);

    const res = await request(app)
      .patch('/api/v1/customers/customer-1/bag-issued')
      .set('Authorization', `Bearer ${token('staff', 'branch-1')}`);

    expect(res.status).toBe(200);
    expect(prismaMock.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'customer-1' }, data: expect.objectContaining({ bagIssued: true }) })
    );
  });

  it('is a no-op (does not reset bagIssuedAt) when already issued', async () => {
    prismaMock.customer.findUnique.mockResolvedValue({ id: 'customer-1', bagIssued: true, bagIssuedAt: new Date('2026-01-01') } as any);

    const res = await request(app)
      .patch('/api/v1/customers/customer-1/bag-issued')
      .set('Authorization', `Bearer ${token('staff', 'branch-1')}`);

    expect(res.status).toBe(200);
    expect(prismaMock.customer.update).not.toHaveBeenCalled();
  });

  it('returns 404 for a customer that does not exist', async () => {
    prismaMock.customer.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/v1/customers/missing-customer/bag-issued')
      .set('Authorization', `Bearer ${token('admin')}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /:id/bag-replacement — staff AND admin, ₹350 fixed fee', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/v1/customers/customer-1/bag-replacement');

    expect(res.status).toBe(401);
  });

  it('rejects when the customer was never issued a bag', async () => {
    prismaMock.customer.findUnique.mockResolvedValue({ id: 'customer-1', bagIssued: false } as any);

    const res = await request(app)
      .post('/api/v1/customers/customer-1/bag-replacement')
      .set('Authorization', `Bearer ${token('staff', 'branch-1')}`);

    expect(res.status).toBe(400);
    expect(prismaMock.additionalCharge.create).not.toHaveBeenCalled();
  });

  it('creates a fixed ₹350 bag_replacement charge for an issued customer (staff-role)', async () => {
    prismaMock.customer.findUnique.mockResolvedValue({ id: 'customer-1', bagIssued: true } as any);
    prismaMock.additionalCharge.create.mockResolvedValue({ id: 'charge-1', amount: 350, chargeType: 'bag_replacement' } as any);

    const res = await request(app)
      .post('/api/v1/customers/customer-1/bag-replacement')
      .set('Authorization', `Bearer ${token('staff', 'branch-1')}`)
      .send({ orderId: 'order-1' });

    expect(res.status).toBe(201);
    expect(prismaMock.additionalCharge.create).toHaveBeenCalledWith({
      data: {
        customerId: 'customer-1',
        orderId: 'order-1',
        chargeType: 'bag_replacement',
        amount: 350,
        description: null,
        createdById: 'user-1',
      },
    });
  });

  it('returns 404 for a customer that does not exist', async () => {
    prismaMock.customer.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/customers/missing-customer/bag-replacement')
      .set('Authorization', `Bearer ${token('admin')}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /:id/bag-replacements — admin-only history', () => {
  it('rejects a staff-role token', async () => {
    const res = await request(app)
      .get('/api/v1/customers/customer-1/bag-replacements')
      .set('Authorization', `Bearer ${token('staff')}`);

    expect(res.status).toBe(403);
    expect(prismaMock.additionalCharge.findMany).not.toHaveBeenCalled();
  });

  it('lists bag_replacement charges for the customer', async () => {
    prismaMock.additionalCharge.findMany.mockResolvedValue([{ id: 'charge-1', amount: 350 } as any]);

    const res = await request(app)
      .get('/api/v1/customers/customer-1/bag-replacements')
      .set('Authorization', `Bearer ${token('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.charges).toHaveLength(1);
    expect(prismaMock.additionalCharge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: 'customer-1', chargeType: 'bag_replacement' } })
    );
  });
});
