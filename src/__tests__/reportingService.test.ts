import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from '../prisma/client';
import { getInvoiceAgingReport, getCustomerStatement, toAgingCsv } from '../services/reportingService';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const INVOICE_BASE = {
  order: {
    orderNumber: 'PB-001',
    orderId: 'order-1',
    customerId: 'customer-1',
    customer: { id: 'customer-1', fullName: 'Test Customer', branchId: 'branch-1', branch: { branchName: 'Attapur' } },
  },
};

beforeEach(() => {
  mockReset(prismaMock);
  prismaMock.invoiceAdjustment.findMany.mockResolvedValue([]);
  prismaMock.paymentReminderLog.findMany.mockResolvedValue([]);
});

describe('getInvoiceAgingReport', () => {
  // Mandatory test #18: invoice aging report.
  it('buckets an invoice correctly by days overdue against its due date', async () => {
    const dueDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days overdue
    prismaMock.invoice.findMany.mockResolvedValue([
      {
        id: 'inv-1',
        orderId: 'order-1',
        invoiceNumber: 'PB-INV-0001',
        amount: 500,
        dueDate,
        createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        payments: [],
        ...INVOICE_BASE,
      },
    ] as any);
    prismaMock.payment.findMany.mockResolvedValue([]); // fully outstanding
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', amount: 500 } as any);

    const rows = await getInvoiceAgingReport();

    expect(rows).toHaveLength(1);
    expect(rows[0].daysOverdue).toBe(10);
    expect(rows[0].agingCategory).toBe('8-15');
    expect(rows[0].outstanding).toBe(500);
    expect(rows[0].branchName).toBe('Attapur');
  });

  it('reports "not_yet_due" for an invoice whose due date is still in the future', async () => {
    const dueDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    prismaMock.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', orderId: 'order-1', invoiceNumber: 'PB-INV-0001', amount: 500, dueDate, createdAt: new Date(), payments: [], ...INVOICE_BASE },
    ] as any);
    prismaMock.payment.findMany.mockResolvedValue([]);
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', amount: 500 } as any);

    const rows = await getInvoiceAgingReport();

    expect(rows[0].agingCategory).toBe('not_yet_due');
    expect(rows[0].daysOverdue).toBe(0);
  });

  it('reports "not_yet_due" for a fully-paid invoice even if its due date has passed (nothing left to chase)', async () => {
    const dueDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    prismaMock.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', orderId: 'order-1', invoiceNumber: 'PB-INV-0001', amount: 500, dueDate, createdAt: new Date(), payments: [], ...INVOICE_BASE },
    ] as any);
    prismaMock.payment.findMany.mockResolvedValue([{ paymentSource: 'cash', amountPaise: 50000n, allocatedPaise: 50000n }] as any);
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', amount: 500 } as any);

    const rows = await getInvoiceAgingReport();

    expect(rows[0].agingCategory).toBe('not_yet_due');
    expect(rows[0].paymentStatus).toBe('paid');
  });

  it('flags verificationStatus pending_verification when a bank_upi payment on the invoice is still pending', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([
      {
        id: 'inv-1',
        orderId: 'order-1',
        invoiceNumber: 'PB-INV-0001',
        amount: 500,
        dueDate: new Date(),
        createdAt: new Date(),
        payments: [{ paymentSource: 'bank_upi', verificationStatus: 'pending', paymentMethod: 'upi', utrReference: 'UTR1', razorpayPaymentId: null, createdAt: new Date(), status: 'success' }],
        ...INVOICE_BASE,
      },
    ] as any);
    prismaMock.payment.findMany.mockResolvedValue([]);
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', amount: 500 } as any);

    const rows = await getInvoiceAgingReport();

    expect(rows[0].verificationStatus).toBe('pending_verification');
    expect(rows[0].bankUpiReferences).toEqual(['UTR1']);
  });

  it('filters by branchId, overriding with a branch-scoped admin\'s own branch', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([]);

    await getInvoiceAgingReport({ branchId: 'branch-1' });

    expect(prismaMock.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          order: expect.objectContaining({ customer: { branchId: 'branch-1' } }),
        }),
      })
    );
  });

  it('includes reminder count and last reminder date for the invoice', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', orderId: 'order-1', invoiceNumber: 'PB-INV-0001', amount: 500, dueDate: new Date(), createdAt: new Date(), payments: [], ...INVOICE_BASE },
    ] as any);
    prismaMock.payment.findMany.mockResolvedValue([]);
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', amount: 500 } as any);
    prismaMock.paymentReminderLog.findMany.mockResolvedValue([{ sentAt: new Date('2026-11-10') }, { sentAt: new Date('2026-11-05') }] as any);

    const rows = await getInvoiceAgingReport();

    expect(rows[0].reminderCount).toBe(2);
    expect(rows[0].lastReminderDate).toEqual(new Date('2026-11-10'));
  });
});

describe('toAgingCsv', () => {
  // Mandatory test #19: export totals reconcile with invoice balances.
  it('produces a CSV whose outstanding column sums to the same total as the source rows', async () => {
    const rows = [
      { branchId: 'b', branchName: 'Attapur', customerId: 'c1', customerName: 'A', orderId: 'o1', orderNumber: 'PB-1', invoiceId: 'i1', invoiceNumber: 'INV-1', invoiceDate: new Date(), dueDate: new Date(), originalAmount: 100, amountPaid: 50, waivedAmount: 0, outstanding: 50, paymentStatus: 'partially_paid' as const, internalSettlementLabel: 'partially_paid' as const, lastPaymentDate: null, paymentMethods: ['cash'], razorpayReferences: [], bankUpiReferences: [], daysOverdue: 0, agingCategory: 'not_yet_due' as const, reminderCount: 0, lastReminderDate: null, verificationStatus: 'n/a' as const },
      { branchId: 'b', branchName: 'Attapur', customerId: 'c2', customerName: 'B', orderId: 'o2', orderNumber: 'PB-2', invoiceId: 'i2', invoiceNumber: 'INV-2', invoiceDate: new Date(), dueDate: new Date(), originalAmount: 200, amountPaid: 0, waivedAmount: 0, outstanding: 200, paymentStatus: 'unpaid' as const, internalSettlementLabel: 'unpaid' as const, lastPaymentDate: null, paymentMethods: [], razorpayReferences: [], bankUpiReferences: [], daysOverdue: 0, agingCategory: 'not_yet_due' as const, reminderCount: 0, lastReminderDate: null, verificationStatus: 'n/a' as const },
    ];

    const csv = toAgingCsv(rows);
    const lines = csv.trim().split('\n');
    const outstandingColIndex = lines[0].split(',').indexOf('Outstanding');
    const sum = lines.slice(1).reduce((acc, line) => acc + Number(line.split(',')[outstandingColIndex]), 0);

    expect(sum).toBe(250);
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it('quotes a field containing a comma', () => {
    const csv = toAgingCsv([
      {
        branchId: 'b', branchName: 'A, B', customerId: 'c1', customerName: 'Test', orderId: 'o1', orderNumber: 'PB-1', invoiceId: 'i1',
        invoiceNumber: 'INV-1', invoiceDate: new Date(), dueDate: null, originalAmount: 100, amountPaid: 0, waivedAmount: 0, outstanding: 100,
        paymentStatus: 'unpaid', internalSettlementLabel: 'unpaid', lastPaymentDate: null, paymentMethods: [], razorpayReferences: [], bankUpiReferences: [],
        daysOverdue: 0, agingCategory: 'not_yet_due', reminderCount: 0, lastReminderDate: null, verificationStatus: 'n/a',
      },
    ]);

    expect(csv).toContain('"A, B"');
  });
});

describe('getCustomerStatement', () => {
  it('404s when the customer does not exist', async () => {
    prismaMock.customer.findUnique.mockResolvedValue(null);
    await expect(getCustomerStatement('missing')).rejects.toMatchObject({ status: 404 });
  });

  // Mandatory test #21: customer statement does not double-count
  // carried-forward (previous) dues — built from Invoice (debit) +
  // PaymentAllocation (credit) only, never InvoicePreviousDuesLine.
  it('computes a running balance from invoices (debits) and allocations (credits) only', async () => {
    prismaMock.customer.findUnique.mockResolvedValue({ id: 'customer-1', fullName: 'Test Customer' } as any);
    prismaMock.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', invoiceNumber: 'INV-1', amount: 100, createdAt: new Date('2026-11-01'), order: { orderNumber: 'PB-1' } },
      { id: 'inv-2', invoiceNumber: 'INV-2', amount: 200, createdAt: new Date('2026-11-05'), order: { orderNumber: 'PB-2' } },
    ] as any);
    prismaMock.paymentAllocation.findMany.mockResolvedValue([
      { invoiceId: 'inv-1', allocatedPaise: 10000n, createdAt: new Date('2026-11-02'), payment: { paymentMethod: 'cash', paymentSource: 'cash' } },
    ] as any);

    const statement = await getCustomerStatement('customer-1');

    // 1 Nov: +100 (inv-1) -> 100. 2 Nov: -100 (allocation) -> 0. 5 Nov: +200 (inv-2) -> 200.
    expect(statement.entries.map((e) => e.runningBalance)).toEqual([100, 0, 200]);
    expect(statement.closingBalance).toBe(200);
  });

  it('never reads InvoicePreviousDuesLine at all when building a statement', async () => {
    prismaMock.customer.findUnique.mockResolvedValue({ id: 'customer-1', fullName: 'Test Customer' } as any);
    prismaMock.invoice.findMany.mockResolvedValue([]);
    prismaMock.paymentAllocation.findMany.mockResolvedValue([]);

    await getCustomerStatement('customer-1');

    expect(prismaMock.invoicePreviousDuesLine.findMany).not.toHaveBeenCalled();
  });
});
