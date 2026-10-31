import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from '../prisma/client';
import {
  getCustomerCreditBalance,
  issueCredit,
  applyCreditToInvoice,
  refundCredit,
  reverseCreditTransaction,
  lockCustomerCreditForUpdate,
} from '../services/customerCreditService';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
});

describe('lockCustomerCreditForUpdate', () => {
  it('issues a SELECT ... FOR UPDATE against the customer row', async () => {
    await lockCustomerCreditForUpdate(prismaMock, 'customer-1');
    expect(prismaMock.$queryRaw).toHaveBeenCalled();
  });
});

describe('getCustomerCreditBalance', () => {
  it('sums issued minus applied minus refunded', async () => {
    prismaMock.customerCredit.findMany.mockResolvedValue([
      { transactionType: 'issued', amountPaise: 50000n, reversalOf: null },
      { transactionType: 'applied', amountPaise: 20000n, reversalOf: null },
      { transactionType: 'refunded', amountPaise: 10000n, reversalOf: null },
    ] as any);

    const balance = await getCustomerCreditBalance(prismaMock, 'customer-1');

    expect(balance.availablePaise).toBe(20000n); // 50000 - 20000 - 10000
    expect(balance.issuedTotalPaise).toBe(50000n);
    expect(balance.appliedTotalPaise).toBe(20000n);
    expect(balance.refundedTotalPaise).toBe(10000n);
  });

  it('a reversal of an issued row subtracts (undoes the original addition)', async () => {
    prismaMock.customerCredit.findMany.mockResolvedValue([
      { transactionType: 'issued', amountPaise: 50000n, reversalOf: null },
      { transactionType: 'reversed', amountPaise: 50000n, reversalOf: { transactionType: 'issued' } },
    ] as any);

    const balance = await getCustomerCreditBalance(prismaMock, 'customer-1');
    expect(balance.availablePaise).toBe(0n);
  });

  it('a reversal of an applied row adds back (undoes the original consumption)', async () => {
    prismaMock.customerCredit.findMany.mockResolvedValue([
      { transactionType: 'issued', amountPaise: 50000n, reversalOf: null },
      { transactionType: 'applied', amountPaise: 30000n, reversalOf: null },
      { transactionType: 'reversed', amountPaise: 30000n, reversalOf: { transactionType: 'applied' } },
    ] as any);

    const balance = await getCustomerCreditBalance(prismaMock, 'customer-1');
    expect(balance.availablePaise).toBe(50000n); // the applied 30000 was given back
  });

  it('never reports a negative balance (defensive floor)', async () => {
    prismaMock.customerCredit.findMany.mockResolvedValue([
      { transactionType: 'applied', amountPaise: 10000n, reversalOf: null },
    ] as any);

    const balance = await getCustomerCreditBalance(prismaMock, 'customer-1');
    expect(balance.availablePaise).toBe(0n);
  });
});

describe('issueCredit', () => {
  it('rejects a non-positive amount', async () => {
    await expect(
      issueCredit(prismaMock, { customerId: 'c-1', amountPaise: 0n, createdById: 'staff-1' })
    ).rejects.toThrow(/greater than zero/);
  });

  it('creates an issued row with the given source payment and reason', async () => {
    prismaMock.customerCredit.create.mockResolvedValue({} as any);
    await issueCredit(prismaMock, {
      customerId: 'c-1',
      amountPaise: 10000n,
      sourcePaymentId: 'payment-1',
      reason: 'Excess cash',
      createdById: 'staff-1',
    });

    expect(prismaMock.customerCredit.create).toHaveBeenCalledWith({
      data: {
        customerId: 'c-1',
        transactionType: 'issued',
        amountPaise: 10000n,
        sourcePaymentId: 'payment-1',
        resolvedExceptionId: null,
        reason: 'Excess cash',
        createdById: 'staff-1',
      },
    });
  });
});

describe('applyCreditToInvoice', () => {
  it('applies the full requested amount when the balance covers it', async () => {
    prismaMock.customerCredit.findMany.mockResolvedValue([
      { transactionType: 'issued', amountPaise: 50000n, reversalOf: null },
    ] as any);
    prismaMock.customerCredit.create.mockResolvedValue({} as any);

    const applied = await applyCreditToInvoice(prismaMock, {
      customerId: 'c-1',
      invoiceId: 'inv-1',
      maxApplicationPaise: 30000n,
      createdById: null,
    });

    expect(applied).toBe(30000n);
    expect(prismaMock.customerCredit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ transactionType: 'applied', amountPaise: 30000n, appliedToInvoiceId: 'inv-1', createdById: null }) })
    );
  });

  it('caps application at the available balance, never applying more than is available', async () => {
    prismaMock.customerCredit.findMany.mockResolvedValue([
      { transactionType: 'issued', amountPaise: 10000n, reversalOf: null },
    ] as any);
    prismaMock.customerCredit.create.mockResolvedValue({} as any);

    const applied = await applyCreditToInvoice(prismaMock, {
      customerId: 'c-1',
      invoiceId: 'inv-1',
      maxApplicationPaise: 30000n,
      createdById: null,
    });

    expect(applied).toBe(10000n);
  });

  it('returns 0 and writes nothing when there is no available credit', async () => {
    prismaMock.customerCredit.findMany.mockResolvedValue([]);

    const applied = await applyCreditToInvoice(prismaMock, {
      customerId: 'c-1',
      invoiceId: 'inv-1',
      maxApplicationPaise: 30000n,
      createdById: null,
    });

    expect(applied).toBe(0n);
    expect(prismaMock.customerCredit.create).not.toHaveBeenCalled();
  });
});

describe('refundCredit', () => {
  it('rejects a missing reason', async () => {
    await expect(
      refundCredit(prismaMock, { customerId: 'c-1', amountPaise: 1000n, reason: '', createdById: 'admin-1' })
    ).rejects.toThrow(/reason/);
  });

  it('rejects refunding more than the available balance', async () => {
    prismaMock.customerCredit.findMany.mockResolvedValue([
      { transactionType: 'issued', amountPaise: 10000n, reversalOf: null },
    ] as any);

    await expect(
      refundCredit(prismaMock, { customerId: 'c-1', amountPaise: 20000n, reason: 'Customer asked', createdById: 'admin-1' })
    ).rejects.toThrow(/exceeds/);
  });

  it('creates a refunded row when within the available balance', async () => {
    prismaMock.customerCredit.findMany.mockResolvedValue([
      { transactionType: 'issued', amountPaise: 10000n, reversalOf: null },
    ] as any);
    prismaMock.customerCredit.create.mockResolvedValue({} as any);

    await refundCredit(prismaMock, { customerId: 'c-1', amountPaise: 10000n, reason: 'Customer asked', createdById: 'admin-1' });

    expect(prismaMock.customerCredit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ transactionType: 'refunded', amountPaise: 10000n }) })
    );
  });
});

describe('reverseCreditTransaction', () => {
  it('rejects a missing reason', async () => {
    await expect(
      reverseCreditTransaction(prismaMock, { transactionId: 't-1', reason: '', createdById: 'admin-1' })
    ).rejects.toThrow(/reason/);
  });

  it('404s when the transaction does not exist', async () => {
    prismaMock.customerCredit.findUnique.mockResolvedValue(null);
    await expect(
      reverseCreditTransaction(prismaMock, { transactionId: 'missing', reason: 'mistake', createdById: 'admin-1' })
    ).rejects.toThrow(/not found/);
  });

  it('rejects reversing a reversal', async () => {
    prismaMock.customerCredit.findUnique.mockResolvedValue({ id: 't-1', transactionType: 'reversed', customerId: 'c-1' } as any);
    await expect(
      reverseCreditTransaction(prismaMock, { transactionId: 't-1', reason: 'mistake', createdById: 'admin-1' })
    ).rejects.toThrow(/Cannot reverse a reversal/);
  });

  it('rejects reversing an already-reversed transaction', async () => {
    prismaMock.customerCredit.findUnique.mockResolvedValue({ id: 't-1', transactionType: 'issued', customerId: 'c-1' } as any);
    prismaMock.customerCredit.findFirst.mockResolvedValue({ id: 't-2' } as any);
    await expect(
      reverseCreditTransaction(prismaMock, { transactionId: 't-1', reason: 'mistake', createdById: 'admin-1' })
    ).rejects.toThrow(/already been reversed/);
  });

  it('creates a reversed row pointing at the original, without deleting it', async () => {
    prismaMock.customerCredit.findUnique.mockResolvedValue({ id: 't-1', transactionType: 'issued', customerId: 'c-1', amountPaise: 10000n } as any);
    prismaMock.customerCredit.findFirst.mockResolvedValue(null);
    prismaMock.customerCredit.create.mockResolvedValue({} as any);

    await reverseCreditTransaction(prismaMock, { transactionId: 't-1', reason: 'Closed the wrong invoice', createdById: 'admin-1' });

    expect(prismaMock.customerCredit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerId: 'c-1', transactionType: 'reversed', amountPaise: 10000n, reversalOfId: 't-1' }),
      })
    );
    expect(prismaMock.customerCredit.delete).not.toHaveBeenCalled();
    expect(prismaMock.customerCredit.update).not.toHaveBeenCalled();
  });
});
