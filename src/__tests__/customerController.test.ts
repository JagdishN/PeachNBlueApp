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
