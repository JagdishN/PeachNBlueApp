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
import userRoutes from '../routes/users';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const app = express();
app.use(express.json());
app.use('/api/users', userRoutes);
app.use(errorHandler);

const token = (role: 'staff' | 'admin', branchId: string | null = null) =>
  jwt.sign({ userId: 'user-1', role, branchId }, JWT_SECRET);

beforeEach(() => {
  mockReset(prismaMock);
});

describe('GET / — admin-only user list (CLAUDE.md "Staff/Admin account management")', () => {
  it('rejects a staff-role token', async () => {
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token('staff')}`);

    expect(res.status).toBe(403);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/users');

    expect(res.status).toBe(401);
  });

  it('is a real list, not an alias for /me — returns findMany results, not the requester\'s own token payload', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'user-2', fullName: 'Staff Two', phoneNumber: '+919000000002', role: 'staff', branchId: 'branch-1', isActive: true, createdAt: new Date() } as any,
    ]);

    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].id).toBe('user-2');
  });

  it('an unscoped admin with no branchId query param sees every branch', async () => {
    prismaMock.user.findMany.mockResolvedValue([]);

    await request(app).get('/api/users').set('Authorization', `Bearer ${token('admin')}`);

    expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
  });

  it("a branch-scoped admin's own branchId wins over any query param", async () => {
    prismaMock.user.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/users?branchId=some-other-branch')
      .set('Authorization', `Bearer ${token('admin', 'branch-1')}`);

    expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { branchId: 'branch-1' } }));
  });
});

describe('POST / — admin-only account creation', () => {
  it('rejects a staff-role token', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token('staff')}`)
      .send({ fullName: 'New Staff', phoneNumber: '+919000000003', role: 'staff', branchId: 'branch-1' });

    expect(res.status).toBe(403);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid role', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ fullName: 'New Staff', phoneNumber: '+919000000003', role: 'manager' });

    expect(res.status).toBe(400);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('requires a branchId for a staff account', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ fullName: 'New Staff', phoneNumber: '+919000000003', role: 'staff' });

    expect(res.status).toBe(400);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('allows an admin account with no branchId (unscoped)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'user-3',
      fullName: 'New Admin',
      phoneNumber: '+919000000004',
      role: 'admin',
      branchId: null,
      isActive: true,
      createdAt: new Date(),
    } as any);

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ fullName: 'New Admin', phoneNumber: '+919000000004', role: 'admin' });

    expect(res.status).toBe(201);
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fullName: 'New Admin', phoneNumber: '+919000000004', role: 'admin', branchId: null } })
    );
  });

  it('rejects a duplicate phoneNumber with 409', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'existing-user' } as any);

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ fullName: 'New Staff', phoneNumber: '+919000000003', role: 'staff', branchId: 'branch-1' });

    expect(res.status).toBe(409);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('creates a staff account scoped to the given branch', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'user-3',
      fullName: 'New Staff',
      phoneNumber: '+919000000003',
      role: 'staff',
      branchId: 'branch-1',
      isActive: true,
      createdAt: new Date(),
    } as any);

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ fullName: 'New Staff', phoneNumber: '+919000000003', role: 'staff', branchId: 'branch-1' });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'staff', branchId: 'branch-1' });
  });
});
