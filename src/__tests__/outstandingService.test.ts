import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from '../prisma/client';
import { getCustomerOutstandingSummary, allocatePaymentAcrossCustomerInvoices, recordCustomerPayment } from '../services/outstandingService';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
  prismaMock.invoiceAdjustment.findMany.mockResolvedValue([]);
  prismaMock.$transaction.mockImplementation(((cb: any) => cb(prismaMock)) as any);
});

describe('getCustomerOutstandingSummary', () => {
  it('sums outstanding/collected across every non-monthly-billing invoice, oldest due first', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([
      {
        id: 'inv-2',
        orderId: 'order-2',
        invoiceNumber: 'INV-002',
        amount: 200,
        dueDate: new Date('2026-11-09'),
        createdAt: new Date('2026-11-05'),
        order: { orderNumber: 'PB-002' },
      },
      {
        id: 'inv-1',
        orderId: 'order-1',
        invoiceNumber: 'INV-001',
        amount: 100,
        dueDate: new Date('2026-11-05'),
        createdAt: new Date('2026-11-01'),
        order: { orderNumber: 'PB-001' },
      },
      {
        id: 'inv-3',
        orderId: 'order-3',
        invoiceNumber: 'INV-003',
        amount: 150,
        dueDate: new Date('2026-11-14'),
        createdAt: new Date('2026-11-10'),
        order: { orderNumber: 'PB-003' },
      },
    ] as any);

    // getInvoicePaymentSummary reads invoice.findUnique + payment.findMany
    // per invoice — mock by id via a sequential implementation.
    prismaMock.invoice.findUnique.mockImplementation(((args: any) => {
      const amounts: Record<string, number> = { 'inv-1': 100, 'inv-2': 200, 'inv-3': 150 };
      return Promise.resolve({ id: args.where.id, amount: amounts[args.where.id] } as any);
    }) as any);
    prismaMock.payment.findMany.mockImplementation(((args: any) => {
      const paid: Record<string, bigint> = { 'inv-1': 5000n, 'inv-2': 10000n, 'inv-3': 0n };
      const amt = paid[args.where.invoiceId] ?? 0n;
      return Promise.resolve(amt > 0n ? [{ paymentSource: 'cash', amountPaise: amt, allocatedPaise: amt }] : ([] as any));
    }) as any);

    const summary = await getCustomerOutstandingSummary('customer-1');

    expect(summary.totalOriginal).toBe(450);
    expect(summary.totalCollected).toBe(150);
    expect(summary.totalOutstanding).toBe(300);
    // Oldest-due-first order.
    expect(summary.invoices.map((i) => i.invoiceId)).toEqual(['inv-1', 'inv-2', 'inv-3']);
    expect(summary.invoices[0].outstanding).toBe(50);
    expect(summary.invoices[1].outstanding).toBe(100);
    expect(summary.invoices[2].outstanding).toBe(150);
  });

  it('excludes monthly-billing orders entirely (separate financial model)', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([]);

    await getCustomerOutstandingSummary('customer-1');

    expect(prismaMock.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { order: { customerId: 'customer-1', billingMode: { not: 'monthly_billing' } } },
      })
    );
  });
});

describe('allocatePaymentAcrossCustomerInvoices', () => {
  const makeInvoice = (id: string, amount: number, dueDate: string) => ({
    id,
    orderId: `order-${id}`,
    amount,
    dueDate: new Date(dueDate),
    createdAt: new Date(dueDate),
  });

  it('settles the oldest invoice first, then the next, leaving the newest untouched when the payment runs out', async () => {
    // Mirrors the spec's own example: INV-001 ₹50 outstanding, INV-002 ₹100
    // outstanding, INV-003 ₹150 outstanding; a ₹200 payment should clear
    // INV-001 and INV-002 fully and leave INV-003 with ₹50 still due.
    prismaMock.invoice.findMany.mockResolvedValue([
      makeInvoice('inv-1', 50, '2026-11-05'),
      makeInvoice('inv-2', 100, '2026-11-09'),
      makeInvoice('inv-3', 150, '2026-11-14'),
    ] as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-1' } as any);
    // Each invoice's outstanding == its full amount (nothing paid yet) —
    // getInvoicePaymentSummary's own invoice.findUnique/payment.findMany.
    prismaMock.invoice.findUnique.mockImplementation(((args: any) => {
      const amounts: Record<string, number> = { 'inv-1': 50, 'inv-2': 100, 'inv-3': 150 };
      return Promise.resolve({ id: args.where.id, amount: amounts[args.where.id] } as any);
    }) as any);
    prismaMock.payment.findMany.mockResolvedValue([]);

    const result = await allocatePaymentAcrossCustomerInvoices(prismaMock, {
      customerId: 'customer-1',
      grossAmount: 200,
      paymentType: 'customer_payment',
      paymentMethod: 'cash',
      paymentSource: 'cash',
      recordedById: 'admin-1',
    });

    expect(result.touchedInvoices).toEqual([
      { invoiceId: 'inv-1', allocatedPaise: 5000n },
      { invoiceId: 'inv-2', allocatedPaise: 10000n },
      { invoiceId: 'inv-3', allocatedPaise: 5000n },
    ]);
    expect(result.totalAllocatedPaise).toBe(20000n);
    expect(result.excessPaise).toBe(0n);
    expect(prismaMock.paymentReconciliationException.create).not.toHaveBeenCalled();
  });

  it('records a customer-level (no single invoiceId) overpayment exception when the payment exceeds every outstanding invoice', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([makeInvoice('inv-1', 50, '2026-11-05')] as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-1' } as any);
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', amount: 50 } as any);
    prismaMock.payment.findMany.mockResolvedValue([]);

    const result = await allocatePaymentAcrossCustomerInvoices(prismaMock, {
      customerId: 'customer-1',
      grossAmount: 80,
      paymentType: 'customer_payment',
      paymentMethod: 'cash',
      paymentSource: 'cash',
      recordedById: 'admin-1',
    });

    expect(result.excessPaise).toBe(3000n); // ₹30 excess
    expect(prismaMock.paymentReconciliationException.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ invoiceId: null, customerId: 'customer-1', excessPaise: 3000n }) })
    );
  });

  it('records the full amount as a customer-level excess when there are no outstanding invoices at all', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([]);
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-1' } as any);

    const result = await allocatePaymentAcrossCustomerInvoices(prismaMock, {
      customerId: 'customer-1',
      grossAmount: 100,
      paymentType: 'customer_payment',
      paymentMethod: 'cash',
      paymentSource: 'cash',
      recordedById: 'admin-1',
    });

    expect(result.touchedInvoices).toEqual([]);
    expect(result.excessPaise).toBe(10000n);
  });

  it('locks every candidate invoice before allocating anything', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([makeInvoice('inv-1', 50, '2026-11-05')] as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-1' } as any);
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', amount: 50 } as any);
    prismaMock.payment.findMany.mockResolvedValue([]);

    await allocatePaymentAcrossCustomerInvoices(prismaMock, {
      customerId: 'customer-1',
      grossAmount: 50,
      paymentType: 'customer_payment',
      paymentMethod: 'cash',
      paymentSource: 'cash',
      recordedById: 'admin-1',
    });

    expect(prismaMock.$queryRaw).toHaveBeenCalled();
  });
});

describe('recordCustomerPayment', () => {
  it('is idempotent on a repeated idempotencyKey', async () => {
    prismaMock.payment.findUnique.mockResolvedValue({
      id: 'existing-payment',
      amountPaise: 20000n,
      allocatedPaise: 20000n,
    } as any);
    prismaMock.paymentAllocation.findMany.mockResolvedValue([
      { invoiceId: 'inv-1', allocatedPaise: 20000n },
    ] as any);

    const result = await recordCustomerPayment({
      customerId: 'customer-1',
      grossAmount: 200,
      paymentType: 'customer_payment',
      paymentMethod: 'cash',
      paymentSource: 'cash',
      recordedById: 'admin-1',
      idempotencyKey: 'idem-1',
    });

    expect(result.paymentId).toBe('existing-payment');
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });
});
