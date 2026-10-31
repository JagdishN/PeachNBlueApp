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

  // Payment collection / customer advances rework — excessHandling defaults
  // to undefined (the two tests above), preserving the exact prior
  // behavior. Explicitly passing { kind: 'customer_credit' } routes the
  // SAME excess to a CustomerCredit instead, in the SAME transaction as
  // the Payment row — no reconciliation exception at all for this case.
  it('excessHandling: customer_credit — routes the excess to a CustomerCredit instead of a reconciliation exception', async () => {
    baseSetup(500);
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-1', amountPaise: 60000n, allocatedPaise: 50000n } as any);
    prismaMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValue([
      { id: 'payment-1', paymentSource: 'cash', amountPaise: 60000n, allocatedPaise: 50000n },
    ] as any);
    prismaMock.customerCredit.create.mockResolvedValue({} as any);

    const result = await recordVerifiedPayment(prismaMock, {
      invoiceId: 'inv-1',
      orderId: 'order-1',
      customerId: 'customer-1',
      grossAmount: 600,
      paymentType: 'order_payment',
      paymentMethod: 'cash',
      paymentSource: 'cash',
      recordedById: 'staff-1',
      excessHandling: { kind: 'customer_credit', createdById: 'staff-1', reason: 'Excess cash' },
    });

    expect(result.excessPaise).toBe(10000n);
    expect(prismaMock.customerCredit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerId: 'customer-1', transactionType: 'issued', amountPaise: 10000n, sourcePaymentId: 'payment-1', createdById: 'staff-1' }),
      })
    );
    expect(prismaMock.paymentReconciliationException.create).not.toHaveBeenCalled();
  });

  it('excessHandling: reconciliation_exception with a custom exceptionType — overrides the default "overpayment" label', async () => {
    baseSetup(500);
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-1', amountPaise: 60000n, allocatedPaise: 50000n } as any);
    prismaMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValue([
      { id: 'payment-1', paymentSource: 'cash', amountPaise: 60000n, allocatedPaise: 50000n },
    ] as any);

    await recordVerifiedPayment(prismaMock, {
      invoiceId: 'inv-1',
      orderId: 'order-1',
      customerId: 'customer-1',
      grossAmount: 600,
      paymentType: 'order_payment',
      paymentMethod: 'cash',
      paymentSource: 'cash',
      recordedById: 'staff-1',
      excessHandling: { kind: 'reconciliation_exception', exceptionType: 'unapplied_cash_pending_review' },
    });

    expect(prismaMock.paymentReconciliationException.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ exceptionType: 'unapplied_cash_pending_review' }) })
    );
    expect(prismaMock.customerCredit.create).not.toHaveBeenCalled();
  });

  it('stores amountTenderedPaise/changeReturnedPaise on the Payment row when given', async () => {
    baseSetup(500);
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-1', amountPaise: 40000n, allocatedPaise: 40000n } as any);
    prismaMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValue([
      { id: 'payment-1', paymentSource: 'cash', amountPaise: 40000n, allocatedPaise: 40000n },
    ] as any);

    await recordVerifiedPayment(prismaMock, {
      invoiceId: 'inv-1',
      orderId: 'order-1',
      customerId: 'customer-1',
      grossAmount: 400,
      paymentType: 'order_payment',
      paymentMethod: 'cash',
      paymentSource: 'cash',
      recordedById: 'staff-1',
      amountTenderedPaise: 50000n,
      changeReturnedPaise: 10000n,
    });

    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amountTenderedPaise: 50000n, changeReturnedPaise: 10000n }) })
    );
  });

  // Webhook historical-link resolution fix, requirement #10: "for an
  // invoice already closed through an Admin waiver, preserve the waiver and
  // record the late receipt as an exception rather than silently reopening
  // or overwriting the invoice." The invoice has NO real payments at all —
  // it's "paid" purely because an active InvoiceAdjustment already covers
  // the full amount (this is what getInvoicePaymentSummary's waivedPaise
  // does) — so outstandingBeforePaise is already 0 when this late Razorpay
  // receipt is recorded.
  it('records a late payment arriving after a waiver already closed the invoice as a full overpayment exception, without touching the waiver', async () => {
    baseSetup(500);
    prismaMock.invoiceAdjustment.findMany.mockResolvedValue([{ amountPaise: 50000n }] as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-1', amountPaise: 50000n, allocatedPaise: 0n } as any);
    prismaMock.payment.findMany.mockResolvedValueOnce([]).mockResolvedValue([
      { id: 'payment-1', paymentSource: 'razorpay', amountPaise: 50000n, allocatedPaise: 0n },
    ] as any);

    const result = await recordVerifiedPayment(prismaMock, {
      invoiceId: 'inv-1',
      orderId: 'order-1',
      customerId: 'customer-1',
      grossAmount: 500,
      paymentType: 'order_payment',
      paymentMethod: 'credit_card',
      paymentSource: 'razorpay',
      razorpayPaymentId: 'pay_late_1',
    });

    // Nothing allocated — the waiver already covers the whole ₹500, so the
    // entire late receipt becomes excess, not a second allocation.
    expect(result.excessPaise).toBe(50000n);
    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amountPaise: 50000n, allocatedPaise: 0n }) })
    );
    expect(prismaMock.paymentReconciliationException.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ invoiceId: 'inv-1', exceptionType: 'overpayment', excessPaise: 50000n }),
      })
    );
    // Invoice stays settled via the waiver, not reopened to "partially_paid"
    // or anything else — status is still derived from waivedPaise, which
    // this payment never touches.
    expect(prismaMock.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv-1' }, data: { invoicePaymentStatus: 'paid' } })
    );
    // The waiver itself must never be mutated by a late payment landing.
    expect(prismaMock.invoiceAdjustment.update).not.toHaveBeenCalled();
    expect(prismaMock.invoiceAdjustment.delete).not.toHaveBeenCalled();
  });

  // Webhook historical-link resolution fix — dedicated coverage per
  // retirement cause (2026-10-31 follow-up), proving the SAME allocation
  // logic produces the correct result for each real-world situation a late
  // Razorpay payment can land in. The webhook/resolution layer itself
  // doesn't branch on retiredReason (see webhookController.test.ts's
  // "resolves correctly regardless of retirement reason" block) — these
  // three differ only in the invoice's state at the moment the late
  // payment is recorded, which IS reason-specific.
  describe('late payment scenarios by retirement cause', () => {
    // After a reissue, the invoice's required amount can be HIGHER than
    // what the old (pre-reissue) link was originally created for. A late
    // payment for the OLD amount must allocate against the CURRENT
    // (post-reissue) outstanding, not the stale pre-reissue figure.
    it('reissue: a late payment for the pre-reissue amount allocates fully against the new, higher outstanding', async () => {
      baseSetup(700); // post-reissue amount, no payments yet
      prismaMock.payment.create.mockResolvedValue({ id: 'payment-1', amountPaise: 50000n, allocatedPaise: 50000n } as any);
      prismaMock.payment.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ paymentSource: 'razorpay', amountPaise: 50000n, allocatedPaise: 50000n }] as any);

      const result = await recordVerifiedPayment(prismaMock, {
        invoiceId: 'inv-1',
        orderId: 'order-1',
        customerId: 'customer-1',
        grossAmount: 500, // the OLD (pre-reissue) invoice amount, paid late
        paymentType: 'order_payment',
        paymentMethod: 'credit_card',
        paymentSource: 'razorpay',
        razorpayPaymentId: 'pay_late_reissue',
      });

      expect(result.excessPaise).toBe(0n);
      expect(result.summary.status).toBe('partially_paid');
      expect(result.summary.outstandingPaise).toBe(20000n); // 700 - 500
      expect(prismaMock.paymentReconciliationException.create).not.toHaveBeenCalled();
    });

    // Full cash settlement already brought outstanding to 0 before the
    // late Razorpay webhook arrives — same "already paid" shape as the
    // waiver case above, but caused by a real second payment rather than a
    // non-payment waiver.
    it('full cash settlement: a late payment after the invoice was already fully paid in cash is recorded as a full overpayment exception', async () => {
      baseSetup(500);
      prismaMock.payment.create.mockResolvedValue({ id: 'payment-2', amountPaise: 50000n, allocatedPaise: 0n } as any);
      prismaMock.payment.findMany
        .mockResolvedValueOnce([{ paymentSource: 'cash', amountPaise: 50000n, allocatedPaise: 50000n }] as any)
        .mockResolvedValue([
          { paymentSource: 'cash', amountPaise: 50000n, allocatedPaise: 50000n },
          { id: 'payment-2', paymentSource: 'razorpay', amountPaise: 50000n, allocatedPaise: 0n },
        ] as any);

      const result = await recordVerifiedPayment(prismaMock, {
        invoiceId: 'inv-1',
        orderId: 'order-1',
        customerId: 'customer-1',
        grossAmount: 500,
        paymentType: 'order_payment',
        paymentMethod: 'credit_card',
        paymentSource: 'razorpay',
        razorpayPaymentId: 'pay_late_cash_full',
      });

      expect(result.excessPaise).toBe(50000n);
      expect(result.summary.status).toBe('paid'); // stays paid via the cash payment, not reopened
      expect(prismaMock.paymentReconciliationException.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ exceptionType: 'overpayment', excessPaise: 50000n }) })
      );
    });

    // Partial cash + link replacement: the late Razorpay payment is for the
    // OLD link's full original amount (₹880), but ₹300 of that was already
    // collected in cash in the meantime — the late payment must be split:
    // part allocated to the real remaining balance, part surfaced as
    // excess, in the SAME recording. No other test in this file exercises
    // allocatedPaise > 0 AND excessPaise > 0 from one late/historical
    // payment simultaneously.
    it('partial cash + link replacement: a late payment for the old link\'s full amount is split between real allocation and excess', async () => {
      baseSetup(880);
      prismaMock.payment.create.mockResolvedValue({ id: 'payment-2', amountPaise: 88000n, allocatedPaise: 58000n } as any);
      prismaMock.payment.findMany
        .mockResolvedValueOnce([{ paymentSource: 'cash', amountPaise: 30000n, allocatedPaise: 30000n }] as any)
        .mockResolvedValue([
          { paymentSource: 'cash', amountPaise: 30000n, allocatedPaise: 30000n },
          { id: 'payment-2', paymentSource: 'razorpay', amountPaise: 88000n, allocatedPaise: 58000n },
        ] as any);

      const result = await recordVerifiedPayment(prismaMock, {
        invoiceId: 'inv-1',
        orderId: 'order-1',
        customerId: 'customer-1',
        grossAmount: 880, // the OLD link's full original amount, paid late
        paymentType: 'order_payment',
        paymentMethod: 'credit_card',
        paymentSource: 'razorpay',
        razorpayPaymentId: 'pay_late_cash_partial',
      });

      expect(prismaMock.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amountPaise: 88000n, allocatedPaise: 58000n }) })
      );
      expect(result.excessPaise).toBe(30000n); // the ₹300 double-collected with cash
      expect(result.summary.status).toBe('paid'); // 30000 (cash) + 58000 (allocated) = 88000 required
      expect(prismaMock.paymentReconciliationException.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ exceptionType: 'overpayment', excessPaise: 30000n }) })
      );
    });
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
