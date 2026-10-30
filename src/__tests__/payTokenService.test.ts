import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from '../prisma/client';
import { ensurePaymentToken, revokePaymentToken } from '../services/payTokenService';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
});

describe('ensurePaymentToken', () => {
  it('throws when the invoice does not exist', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(null);
    await expect(ensurePaymentToken('missing')).rejects.toThrow('not found');
  });

  it('returns the existing token unchanged when one is already set', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', paymentToken: 'already-set' } as any);

    const token = await ensurePaymentToken('inv-1');

    expect(token).toBe('already-set');
    expect(prismaMock.invoice.update).not.toHaveBeenCalled();
  });

  it('generates and persists a new, sufficiently random token when none exists', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', paymentToken: null } as any);
    prismaMock.invoice.update.mockResolvedValue({} as any);

    const token = await ensurePaymentToken('inv-1');

    expect(token).toHaveLength(64); // 32 bytes as hex
    expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
    expect(prismaMock.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { paymentToken: token } });
  });

  it('generates a different token on each call when none exists yet', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', paymentToken: null } as any);
    prismaMock.invoice.update.mockResolvedValue({} as any);

    const tokenA = await ensurePaymentToken('inv-1');
    const tokenB = await ensurePaymentToken('inv-1');

    expect(tokenA).not.toBe(tokenB);
  });
});

describe('revokePaymentToken', () => {
  it('clears the token on the given invoice', async () => {
    prismaMock.invoice.update.mockResolvedValue({} as any);

    await revokePaymentToken('inv-1');

    expect(prismaMock.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { paymentToken: null } });
  });
});
