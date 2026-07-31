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

// MOCK_AUTH mutable per-test via jest.resetModules — see the "MOCK_AUTH" describe block below.
const configMock = {
  JWT_SECRET: 'test-secret-key',
  JWT_EXPIRES_IN: '30m',
  MOCK_AUTH: false,
  NODE_ENV: 'test',
  OTP_EXPIRY_MINUTES: 10,
};
jest.mock('../config', () => configMock);

jest.mock('../services/otpService', () => ({
  checkOtpRateLimit: jest.fn(),
  generateOtp: jest.fn(),
  saveOtpAttempt: jest.fn(),
  sendOtpViaChannels: jest.fn(),
  verifyOtpCode: jest.fn(),
}));

import prisma from '../prisma/client';
import { errorHandler } from '../middleware/errorHandler';
import authRoutes from '../routes/auth';
import {
  checkOtpRateLimit,
  generateOtp,
  saveOtpAttempt,
  sendOtpViaChannels,
  verifyOtpCode,
} from '../services/otpService';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const otpMocks = {
  checkOtpRateLimit: checkOtpRateLimit as jest.Mock,
  generateOtp: generateOtp as jest.Mock,
  saveOtpAttempt: saveOtpAttempt as jest.Mock,
  sendOtpViaChannels: sendOtpViaChannels as jest.Mock,
  verifyOtpCode: verifyOtpCode as jest.Mock,
};

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use(errorHandler);

const existingUser = {
  id: 'user-1',
  fullName: 'PeachandBlue (Admin 1)',
  phoneNumber: '+919885025151',
  role: 'admin',
  branchId: null,
  isActive: true,
  createdAt: new Date(),
};

beforeEach(() => {
  mockReset(prismaMock);
  configMock.MOCK_AUTH = false;
  otpMocks.checkOtpRateLimit.mockReset().mockResolvedValue(true);
  otpMocks.generateOtp.mockReset().mockReturnValue('654321');
  otpMocks.saveOtpAttempt.mockReset().mockResolvedValue(undefined);
  otpMocks.sendOtpViaChannels.mockReset().mockResolvedValue(undefined);
  otpMocks.verifyOtpCode.mockReset().mockResolvedValue(true);
});

describe('POST /request-otp', () => {
  it('requires a phoneNumber', async () => {
    const res = await request(app).post('/api/auth/request-otp').send({});

    expect(res.status).toBe(400);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('404s an unregistered phone number, real lookup always runs regardless of MOCK_AUTH (CLAUDE.md "Login bug")', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/auth/request-otp').send({ phoneNumber: '+919999999999' });

    expect(res.status).toBe(404);
    expect(otpMocks.checkOtpRateLimit).not.toHaveBeenCalled();
    expect(otpMocks.sendOtpViaChannels).not.toHaveBeenCalled();
  });

  it('404s an unregistered number even under MOCK_AUTH — role/existence always comes from the real DB lookup', async () => {
    configMock.MOCK_AUTH = true;
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/auth/request-otp').send({ phoneNumber: '+919999999999' });

    expect(res.status).toBe(404);
  });

  it('429s once the rate limit is exceeded', async () => {
    prismaMock.user.findUnique.mockResolvedValue(existingUser as any);
    otpMocks.checkOtpRateLimit.mockResolvedValue(false);

    const res = await request(app).post('/api/auth/request-otp').send({ phoneNumber: existingUser.phoneNumber });

    expect(res.status).toBe(429);
    expect(otpMocks.sendOtpViaChannels).not.toHaveBeenCalled();
  });

  it('sends a generated OTP via both channels for a real, non-mock request', async () => {
    prismaMock.user.findUnique.mockResolvedValue(existingUser as any);

    const res = await request(app).post('/api/auth/request-otp').send({ phoneNumber: existingUser.phoneNumber });

    expect(res.status).toBe(200);
    expect(otpMocks.generateOtp).toHaveBeenCalled();
    expect(otpMocks.saveOtpAttempt).toHaveBeenCalledWith(existingUser.phoneNumber, '654321', 10);
    expect(otpMocks.sendOtpViaChannels).toHaveBeenCalledWith(existingUser.phoneNumber, '654321');
  });

  it('under MOCK_AUTH, uses the fixed code and never calls Twilio', async () => {
    configMock.MOCK_AUTH = true;
    prismaMock.user.findUnique.mockResolvedValue(existingUser as any);

    const res = await request(app).post('/api/auth/request-otp').send({ phoneNumber: existingUser.phoneNumber });

    expect(res.status).toBe(200);
    expect(otpMocks.generateOtp).not.toHaveBeenCalled();
    expect(otpMocks.saveOtpAttempt).toHaveBeenCalledWith(existingUser.phoneNumber, '123456', 10);
    expect(otpMocks.sendOtpViaChannels).not.toHaveBeenCalled();
  });
});

describe('POST /verify-otp', () => {
  it('requires phoneNumber and otp', async () => {
    const res = await request(app).post('/api/auth/verify-otp').send({ phoneNumber: existingUser.phoneNumber });

    expect(res.status).toBe(400);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('404s an unregistered phone number', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phoneNumber: '+919999999999', otp: '123456' });

    expect(res.status).toBe(404);
    expect(otpMocks.verifyOtpCode).not.toHaveBeenCalled();
  });

  it('401s an invalid or expired OTP', async () => {
    prismaMock.user.findUnique.mockResolvedValue(existingUser as any);
    otpMocks.verifyOtpCode.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phoneNumber: existingUser.phoneNumber, otp: '000000' });

    expect(res.status).toBe(401);
  });

  it('issues a JWT embedding the DB role/branchId on success, regardless of any client-supplied hint', async () => {
    prismaMock.user.findUnique.mockResolvedValue(existingUser as any);

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phoneNumber: existingUser.phoneNumber, otp: '123456', roleHint: 'staff' });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 'user-1', role: 'admin', branchId: null });

    const decoded = jwt.verify(res.body.token, 'test-secret-key') as any;
    expect(decoded).toMatchObject({ userId: 'user-1', role: 'admin', branchId: null });
  });

  it('embeds a staff role and branchId for a staff user', async () => {
    const staffUser = { ...existingUser, id: 'user-2', role: 'staff', branchId: 'branch-1' };
    prismaMock.user.findUnique.mockResolvedValue(staffUser as any);

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phoneNumber: staffUser.phoneNumber, otp: '123456' });

    expect(res.status).toBe(200);
    const decoded = jwt.verify(res.body.token, 'test-secret-key') as any;
    expect(decoded).toMatchObject({ userId: 'user-2', role: 'staff', branchId: 'branch-1' });
  });
});
