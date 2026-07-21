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
jest.mock('../config', () => ({ JWT_SECRET: 'test-secret-key' }));

import prisma from '../prisma/client';
import { errorHandler } from '../middleware/errorHandler';
import { JWT_SECRET } from '../config';
import garmentRoutes from '../routes/garments';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const app = express();
app.use(express.json());
app.use('/api/v1/garments', garmentRoutes);
app.use(errorHandler);

const token = (role: 'staff' | 'admin', branchId: string | null = null) =>
  jwt.sign({ userId: 'user-1', role, branchId }, JWT_SECRET);

beforeEach(() => {
  mockReset(prismaMock);
});

// CLAUDE.md "requiresSpecialCare — RESOLVED" known gap, now closed: the admin
// CRUD handlers only wired itemName/price/serviceType (and later
// requiresSpecialCare) — category/pricingUnit/priceMax/isStartingPrice were
// seed-managed only. These tests cover the newly-wired fields.
describe('POST / — create, admin-only, full pricing-field support', () => {
  it('rejects a staff-role token', async () => {
    const res = await request(app)
      .post('/api/v1/garments')
      .set('Authorization', `Bearer ${token('staff')}`)
      .send({ itemName: 'Shirt', serviceType: 'dry_clean', price: 100 });

    expect(res.status).toBe(403);
    expect(prismaMock.garmentCatalogue.create).not.toHaveBeenCalled();
  });

  it('passes category/pricingUnit/priceMax/isStartingPrice/requiresSpecialCare through to the create call', async () => {
    prismaMock.garmentCatalogue.create.mockResolvedValue({ id: 'g-1' } as any);

    await request(app)
      .post('/api/v1/garments')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({
        itemName: 'Sofa Cover',
        serviceType: 'dry_clean',
        price: 300,
        category: 'Household',
        pricingUnit: 'per_piece',
        isStartingPrice: true,
        requiresSpecialCare: true,
      });

    expect(prismaMock.garmentCatalogue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: 'Household',
          pricingUnit: 'per_piece',
          isStartingPrice: true,
          requiresSpecialCare: true,
        }),
      })
    );
  });

  it('rejects an invalid pricingUnit', async () => {
    const res = await request(app)
      .post('/api/v1/garments')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ itemName: 'Shirt', serviceType: 'dry_clean', price: 100, pricingUnit: 'per_dozen' });

    expect(res.status).toBe(400);
    expect(prismaMock.garmentCatalogue.create).not.toHaveBeenCalled();
  });

  it('rejects a priceMax lower than price', async () => {
    const res = await request(app)
      .post('/api/v1/garments')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ itemName: 'Designer Dress', serviceType: 'dry_clean', price: 150, priceMax: 80 });

    expect(res.status).toBe(400);
    expect(prismaMock.garmentCatalogue.create).not.toHaveBeenCalled();
  });

  it('accepts a priceMax at or above price', async () => {
    prismaMock.garmentCatalogue.create.mockResolvedValue({ id: 'g-1' } as any);

    const res = await request(app)
      .post('/api/v1/garments')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ itemName: 'Designer Dress', serviceType: 'dry_clean', price: 80, priceMax: 150 });

    expect(res.status).toBe(201);
  });

  it('rejects a non-boolean isStartingPrice', async () => {
    const res = await request(app)
      .post('/api/v1/garments')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ itemName: 'Shirt', serviceType: 'dry_clean', price: 100, isStartingPrice: 'yes' });

    expect(res.status).toBe(400);
    expect(prismaMock.garmentCatalogue.create).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean requiresSpecialCare', async () => {
    const res = await request(app)
      .post('/api/v1/garments')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ itemName: 'Shirt', serviceType: 'dry_clean', price: 100, requiresSpecialCare: 'yes' });

    expect(res.status).toBe(400);
    expect(prismaMock.garmentCatalogue.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /:id — update, admin-only, full pricing-field support', () => {
  it('rejects a staff-role token', async () => {
    const res = await request(app)
      .patch('/api/v1/garments/g-1')
      .set('Authorization', `Bearer ${token('staff')}`)
      .send({ requiresSpecialCare: true });

    expect(res.status).toBe(403);
    expect(prismaMock.garmentCatalogue.update).not.toHaveBeenCalled();
  });

  it('passes the new fields through to the update call', async () => {
    prismaMock.garmentCatalogue.update.mockResolvedValue({ id: 'g-1' } as any);

    await request(app)
      .patch('/api/v1/garments/g-1')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ category: 'Iron Services — Men\'s Wear', pricingUnit: 'per_piece', requiresSpecialCare: false });

    expect(prismaMock.garmentCatalogue.update).toHaveBeenCalledWith({
      where: { id: 'g-1' },
      data: expect.objectContaining({
        category: "Iron Services — Men's Wear",
        pricingUnit: 'per_piece',
        requiresSpecialCare: false,
      }),
    });
  });

  it('rejects an invalid pricingUnit on update', async () => {
    const res = await request(app)
      .patch('/api/v1/garments/g-1')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ pricingUnit: 'per_dozen' });

    expect(res.status).toBe(400);
    expect(prismaMock.garmentCatalogue.update).not.toHaveBeenCalled();
  });
});
