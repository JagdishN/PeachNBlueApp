import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from '../prisma/client';
import {
  getInvoicePaymentSummary,
  allocateAgainstOutstanding,
  recordVerifiedPayment,
  lockInvoiceForUpdate,
} from '../services/paymentLedgerService';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
  prismaMock.invoiceAdjustment.findMany.mockResolvedValue([]);
});

describe('allocateAgainstOutstanding (pure math)', () => {
  it('allocates the full gross amount when it does not exceed outstanding', () => {
    expect(allocateAgainstOutstanding(30000n, 88000n)).toEqual({ allocatedPaise: 30000n, excessPaise: 0n });
  });

  it('caps allocation at the outstanding amount and surfaces the rest as excess', () => {
    expect(allocateAgainstOutstanding(100000n, 49900n)).toEqual({ allocatedPaise: 49900n, excessPaise: 50100n });
  });

  it('allocates nothing (all excess) when there is no outstanding balance left', () => {
    expect(allocateAgainstOutstanding(50000n, 0n)).toEqual({ allocatedPaise: 0n, excessPaise: 50000n });
  });
});

describe('getInvoicePaymentSummary', () => {
  it('computes outstanding as required minus allocated, across multiple verified payments', () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', amount: 880 } as any);
    prismaMock.payment.findMany.mockResolvedValue([
      { paymentSource: 'cash', amountPaise: 30000n, allocatedPaise: 30000n },
      { paymentSource: 'bank_upi', amountPaise: 20000n, allocatedPaise: 20000n },
    ] as any);

    return getInvoicePaymentSummary(prismaMock, 'inv-1').then((summary) => {
      expect(summary.requiredPaise).toBe(88000n);
      expect(summary.collectedPaise).toBe(50000n);
      expect(summary.allocatedPaise).toBe(50000n);
      expect(summary.outstandingPaise).toBe(38000n);
      expect(summary.status).toBe('partially_paid');
      expect(summary.byMethod).toEqual({ cash: 30000n, bank_upi: 20000n });
    });
  });

  it('reports status "paid" once allocated meets or exceeds required', () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', amount: 500 } as any);
    prismaMock.payment.findMany.mockResolvedValue([
      { paymentSource: 'cash', amountPaise: 50000n, allocatedPaise: 50000n },
    ] as any);

    return getInvoicePaymentSummary(prismaMock, 'inv-1').then((summary) => {
      expect(summary.status).toBe('paid');
      expect(summary.outstandingPaise).toBe(0n);
    });
  });

  it('reports status "unpaid" and the full required amount when nothing has been verified yet', () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', amount: 500 } as any);
    prismaMock.payment.findMany.mockResolvedValue([]);

    return getInvoicePaymentSummary(prismaMock, 'inv-1').then((summary) => {
      expect(summary.status).toBe('unpaid');
      expect(summary.outstandingPaise).toBe(50000n);
    });
  });

  it('separates unallocated excess from allocated — an overpaid invoice still reports outstanding 0, not negative', () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', amount: 500 } as any);
    prismaMock.payment.findMany.mockResolvedValue([
      { paymentSource: 'cash', amountPaise: 50000n, allocatedPaise: 50000n },
      { paymentSource: 'razorpay', amountPaise: 50000n, allocatedPaise: 0n },
    ] as any);

    return getInvoicePaymentSummary(prismaMock, 'inv-1').then((summary) => {
      expect(summary.outstandingPaise).toBe(0n);
      expect(summary.collectedPaise).toBe(100000n);
      expect(summary.unallocatedExcessPaise).toBe(50000n);
    });
  });

  it('throws when the invoice does not exist', () => {
    prismaMock.invoice.findUnique.mockResolvedValue(null);
    return expect(getInvoicePaymentSummary(prismaMock, 'missing')).rejects.toThrow('not found');
  });
});

describe('lockInvoiceForUpdate', () => {
  it('issues a SELECT ... FOR UPDATE against the invoice row', async () => {
    await lockInvoiceForUpdate(prismaMock, 'inv-1');
    expect(prismaMock.$queryRaw).toHaveBeenCalled();
  });
});

describe('recordVerifiedPayment', () => {
  const baseSetup = (invoiceAmount: number, existingPayments: any[] = []) => {
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', amount: invoiceAmount } as any);
    prismaMock.payment.findMany.mockResolvedValue(existingPayments);
  };

  it('allocates the full amount and marks the invoice/order paid when it exactly covers the outstanding balance', async () => {
    baseSetup(500);
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-1', amountPaise: 50000n, allocatedPaise: 50000n } as any);
    // First read (before allocating) sees nothing yet; every read after the
    // Payment row is created (recalculateInvoiceStatus, then the final
    // summary) sees it — mirrors how a real Postgres transaction's later
    // reads see its own earlier writes, which this static mock doesn't do
    // automatically.
    prismaMock.payment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ paymentSource: 'cash', amountPaise: 50000n, allocatedPaise: 50000n }] as any);

    const result = await recordVerifiedPayment(prismaMock, {
      invoiceId: 'inv-1',
      orderId: 'order-1',
      customerId: 'customer-1',
      grossAmount: 500,
      paymentType: 'order_payment',
      paymentMethod: 'cash',
      paymentSource: 'cash',
      recordedById: 'staff-1',
    });

    expect(result.summary.status).toBe('paid');
    expect(result.excessPaise).toBe(0n);
    expect(prismaMock.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv-1' }, data: { invoicePaymentStatus: 'paid' } })
    );
    expect(prismaMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-1' }, data: { paymentStatus: 'paid' } })
    );
  });

  it('allocates only up to the outstanding balance and records an overpayment exception for the rest', async () => {
    baseSetup(500);
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-1', amountPaise: 60000n, allocatedPaise: 50000n } as any);
    prismaMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValue([
      { id: 'payment-1', paymentSource: 'cash', amountPaise: 60000n, allocatedPaise: 50000n },
    ] as any);

    const result = await recordVerifiedPayment(prismaMock, {
      invoiceId: 'inv-1',
      orderId: 'order-1',
      customerId: 'customer-1',
      grossAmount: 600, // ₹100 more than the ₹500 owed
      paymentType: 'order_payment',
      paymentMethod: 'cash',
      paymentSource: 'cash',
      recordedById: 'staff-1',
    });

    expect(result.excessPaise).toBe(10000n); // ₹100 excess
    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amountPaise: 60000n, allocatedPaise: 50000n }) })
    );
    expect(prismaMock.paymentReconciliationException.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ invoiceId: 'inv-1', exceptionType: 'overpayment', excessPaise: 10000n }),
      })
    );
  });

  it('leaves a partial payment correctly marked partially_paid with the right outstanding amount', async () => {
    baseSetup(880);
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-1', amountPaise: 30000n, allocatedPaise: 30000n } as any);
    prismaMock.payment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ paymentSource: 'cash', amountPaise: 30000n, allocatedPaise: 30000n }] as any);

    const result = await recordVerifiedPayment(prismaMock, {
      invoiceId: 'inv-1',
      orderId: 'order-1',
      customerId: 'customer-1',
      grossAmount: 300,
      paymentType: 'order_payment',
      paymentMethod: 'cash',
      paymentSource: 'cash',
      recordedById: 'staff-1',
    });

    expect(result.summary.status).toBe('partially_paid');
    expect(result.summary.outstandingPaise).toBe(58000n); // 880 - 300
  });

  // Outstanding-dues rework: every verified allocation gets a mirroring
  // PaymentAllocation row, so reports have ONE canonical place to read
  // "which payment settled which invoice" from.
  it('writes a mirroring PaymentAllocation row for a verified single-invoice payment', async () => {
    baseSetup(500);
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-1', amountPaise: 50000n, allocatedPaise: 50000n } as any);

    await recordVerifiedPayment(prismaMock, {
      invoiceId: 'inv-1',
      orderId: 'order-1',
      customerId: 'customer-1',
      grossAmount: 500,
      paymentType: 'order_payment',
      paymentMethod: 'cash',
      paymentSource: 'cash',
      recordedById: 'staff-1',
    });

    expect(prismaMock.paymentAllocation.create).toHaveBeenCalledWith({
      data: { paymentId: 'payment-1', invoiceId: 'inv-1', allocatedPaise: 50000n },
    });
  });

  it('does not write a PaymentAllocation row when nothing was actually allocated (a pending report)', async () => {
    baseSetup(500);
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-1', amountPaise: 20000n, allocatedPaise: 0n } as any);

    await recordVerifiedPayment(prismaMock, {
      invoiceId: 'inv-1',
      orderId: 'order-1',
      customerId: 'customer-1',
      grossAmount: 200,
      paymentType: 'order_payment',
      paymentMethod: 'upi',
      paymentSource: 'bank_upi',
      recordedById: 'staff-1',
      verificationStatus: 'pending',
    });

    expect(prismaMock.paymentAllocation.create).not.toHaveBeenCalled();
  });

  it('a pending (unverified) payment allocates nothing and does not touch the invoice/order status', async () => {
    baseSetup(500);
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-1', amountPaise: 20000n, allocatedPaise: 0n } as any);

    const result = await recordVerifiedPayment(prismaMock, {
      invoiceId: 'inv-1',
      orderId: 'order-1',
      customerId: 'customer-1',
      grossAmount: 200,
      paymentType: 'order_payment',
      paymentMethod: 'upi',
      paymentSource: 'bank_upi',
      recordedById: 'staff-1',
      verificationStatus: 'pending',
      utrReference: 'UTR123456',
    });

    expect(result.payment.allocatedPaise).toBe(0n);
    expect(prismaMock.invoice.update).not.toHaveBeenCalled();
    expect(prismaMock.order.update).not.toHaveBeenCalled();
    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ verificationStatus: 'pending', utrReference: 'UTR123456', allocatedPaise: 0n }),
      })
    );
  });

  // Mandatory test #21/#22 (mixed payments): cash + bank_upi(verified) +
  // razorpay together settle one invoice exactly, with no double-counting
  // and no leftover outstanding balance.
  it('settles one invoice via three different payment sources summed together (mixed payments)', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', amount: 880 } as any);
    // ₹300 cash + ₹200 bank_upi (already verified) already recorded;
    // this third payment is the final ₹380 via Razorpay.
    prismaMock.payment.findMany
      .mockResolvedValueOnce([
        { paymentSource: 'cash', amountPaise: 30000n, allocatedPaise: 30000n },
        { paymentSource: 'bank_upi', amountPaise: 20000n, allocatedPaise: 20000n },
      ] as any)
      .mockResolvedValue([
        { paymentSource: 'cash', amountPaise: 30000n, allocatedPaise: 30000n },
        { paymentSource: 'bank_upi', amountPaise: 20000n, allocatedPaise: 20000n },
        { paymentSource: 'razorpay', amountPaise: 38000n, allocatedPaise: 38000n },
      ] as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-3', amountPaise: 38000n, allocatedPaise: 38000n } as any);

    const result = await recordVerifiedPayment(prismaMock, {
      invoiceId: 'inv-1',
      orderId: 'order-1',
      customerId: 'customer-1',
      grossAmount: 380,
      paymentType: 'order_payment',
      paymentMethod: 'upi',
      paymentSource: 'razorpay',
      razorpayPaymentId: 'pay_final',
    });

    expect(result.summary.status).toBe('paid');
    expect(result.summary.outstandingPaise).toBe(0n);
    expect(result.summary.byMethod).toEqual({ cash: 30000n, bank_upi: 20000n, razorpay: 38000n });
    expect(result.excessPaise).toBe(0n);
  });

  it('locks the invoice row before reading the outstanding balance', async () => {
    baseSetup(500);
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-1', amountPaise: 50000n, allocatedPaise: 50000n } as any);

    await recordVerifiedPayment(prismaMock, {
      invoiceId: 'inv-1',
      orderId: 'order-1',
      customerId: 'customer-1',
      grossAmount: 500,
      paymentType: 'order_payment',
      paymentMethod: 'cash',
      paymentSource: 'cash',
      recordedById: 'staff-1',
    });

    expect(prismaMock.$queryRaw).toHaveBeenCalled();
  });
});
