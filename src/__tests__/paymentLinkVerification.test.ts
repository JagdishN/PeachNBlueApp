import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

const fetchPaymentLinkMock = jest.fn();
jest.mock('../lib/razorpayClient', () => ({
  fetchPaymentLink: (...args: unknown[]) => fetchPaymentLinkMock(...args),
}));

const retireOrReplaceLinkMock = jest.fn();
jest.mock('../services/paymentLinkLifecycle', () => ({
  retireOrReplaceLink: (...args: unknown[]) => retireOrReplaceLinkMock(...args),
}));

const recordOnlinePaymentMock = jest.fn();
jest.mock('../services/orderService', () => ({
  recordOnlinePayment: (...args: unknown[]) => recordOnlinePaymentMock(...args),
}));

import prisma from '../prisma/client';
import { getLivePaymentLinkState, resendPaymentLink } from '../services/paymentLinkVerification';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const INVOICE = {
  id: 'inv-1',
  orderId: 'order-1',
  amount: 500,
  invoicePaymentStatus: 'unpaid',
  razorpayPaymentLinkId: 'plink_1',
  paymentLinkUrl: 'https://rzp.io/l/1',
  paymentLinkStatus: 'created',
  order: { id: 'order-1', orderNumber: 'PB-TEST', customerId: 'customer-1' },
};

beforeEach(() => {
  mockReset(prismaMock);
  fetchPaymentLinkMock.mockReset();
  retireOrReplaceLinkMock.mockReset();
  recordOnlinePaymentMock.mockReset();
  prismaMock.invoiceAdjustment.findMany.mockResolvedValue([]);
  prismaMock.payment.findMany.mockResolvedValue([]);
  prismaMock.invoice.findUnique.mockResolvedValue(INVOICE as any);
});

describe('getLivePaymentLinkState', () => {
  it('reconciles a payment Razorpay confirms but our own DB has no record of (a missed webhook)', async () => {
    fetchPaymentLinkMock.mockResolvedValue({
      success: true,
      status: 'paid',
      payments: [{ id: 'pay_live_1', status: 'captured', amount: 50000, method: 'upi' }],
    });
    prismaMock.payment.findUnique.mockResolvedValue(null); // not yet recorded locally

    const result = await getLivePaymentLinkState('inv-1');

    expect(recordOnlinePaymentMock).toHaveBeenCalledWith('order-1', 'upi', 500, 'pay_live_1', 'upi');
    expect(result.reconciledNow).toBe(true);
  });

  it('does not re-record a payment already present locally (dedup by razorpayPaymentId)', async () => {
    fetchPaymentLinkMock.mockResolvedValue({
      success: true,
      status: 'paid',
      payments: [{ id: 'pay_live_1', status: 'captured', amount: 50000, method: 'upi' }],
    });
    prismaMock.payment.findUnique.mockResolvedValue({ id: 'already-recorded' } as any);

    const result = await getLivePaymentLinkState('inv-1');

    expect(recordOnlinePaymentMock).not.toHaveBeenCalled();
    expect(result.reconciledNow).toBe(false);
  });

  it('never calls Razorpay at all once the invoice is already paid in our own DB', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ ...INVOICE, invoicePaymentStatus: 'paid' } as any);

    await getLivePaymentLinkState('inv-1');

    expect(fetchPaymentLinkMock).not.toHaveBeenCalled();
  });

  it('falls back to last-known DB state without throwing when the live fetch fails', async () => {
    fetchPaymentLinkMock.mockResolvedValue({ success: false, error: 'timeout' });

    const result = await getLivePaymentLinkState('inv-1');

    expect(result.reconciledNow).toBe(false);
    expect(result.paymentLinkStatus).toBe('created');
  });
});

describe('resendPaymentLink', () => {
  // Corrections round: "must confirm the existing link is valid, belongs
  // to the correct invoice, and matches the current outstanding balance
  // before reusing it" — all three checked live, never assumed.
  it('reuses the existing link when it is still payable, belongs to this order, and its amount matches current outstanding', async () => {
    fetchPaymentLinkMock.mockResolvedValue({
      success: true,
      status: 'created',
      amount: 50000,
      notes: { orderId: 'order-1' },
    });

    const result = await resendPaymentLink('inv-1', 'staff-1');

    expect(result.reused).toBe(true);
    expect(result.razorpayPaymentLinkId).toBe('plink_1');
    expect(retireOrReplaceLinkMock).not.toHaveBeenCalled();
  });

  it('reissues instead of reusing when the live link amount does not match current outstanding (e.g. a payment was collected since)', async () => {
    // ₹300 collected of ₹500 — ₹200 outstanding, but the live link is still for the stale ₹500.
    prismaMock.payment.findMany.mockResolvedValue([
      { paymentSource: 'cash', amountPaise: 30000n, allocatedPaise: 30000n },
    ] as any);
    fetchPaymentLinkMock.mockResolvedValue({ success: true, status: 'created', amount: 50000, notes: { orderId: 'order-1' } });
    retireOrReplaceLinkMock.mockResolvedValue({ completed: true, newPaymentLinkId: 'plink_new', newPaymentLinkUrl: 'https://rzp.io/l/new' });

    const result = await resendPaymentLink('inv-1', 'staff-1');

    expect(result.reused).toBe(false);
    expect(retireOrReplaceLinkMock).toHaveBeenCalledWith('inv-1', 'reissue', 'staff-1');
    expect(result.razorpayPaymentLinkId).toBe('plink_new');
  });

  it('reissues instead of reusing when the link belongs to a different order (notes mismatch)', async () => {
    fetchPaymentLinkMock.mockResolvedValue({ success: true, status: 'created', amount: 50000, notes: { orderId: 'some-other-order' } });
    retireOrReplaceLinkMock.mockResolvedValue({ completed: true, newPaymentLinkId: 'plink_new', newPaymentLinkUrl: 'https://rzp.io/l/new' });

    const result = await resendPaymentLink('inv-1', 'staff-1');

    expect(result.reused).toBe(false);
    expect(retireOrReplaceLinkMock).toHaveBeenCalled();
  });

  it('reissues instead of reusing when Razorpay reports the link as no longer payable (paid/cancelled/expired)', async () => {
    fetchPaymentLinkMock.mockResolvedValue({ success: true, status: 'cancelled', amount: 50000, notes: { orderId: 'order-1' } });
    retireOrReplaceLinkMock.mockResolvedValue({ completed: true, newPaymentLinkId: 'plink_new', newPaymentLinkUrl: 'https://rzp.io/l/new' });

    const result = await resendPaymentLink('inv-1', 'staff-1');

    expect(result.reused).toBe(false);
    expect(retireOrReplaceLinkMock).toHaveBeenCalled();
  });

  it('does not call retireOrReplaceLink at all when the invoice is already fully settled', async () => {
    // invoicePaymentStatus: 'paid' is what a real settled invoice has
    // (set by paymentLedgerService.ts's recalculateInvoiceStatus whenever a
    // verified payment lands) — this is also what makes getLivePaymentLinkState
    // skip the live Razorpay check entirely for an invoice already known
    // paid in our own DB.
    prismaMock.invoice.findUnique.mockResolvedValue({ ...INVOICE, invoicePaymentStatus: 'paid' } as any);
    prismaMock.payment.findMany.mockResolvedValue([
      { paymentSource: 'cash', amountPaise: 50000n, allocatedPaise: 50000n },
    ] as any);

    const result = await resendPaymentLink('inv-1', 'staff-1');

    expect(retireOrReplaceLinkMock).not.toHaveBeenCalled();
    expect(result.completed).toBe(true);
  });
});
