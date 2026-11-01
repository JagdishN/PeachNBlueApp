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

import prisma from '../prisma/client';
import { checkPaymentLinkConsistency } from '../services/paymentLinkConsistency';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const INVOICE_NO_LINK = {
  id: 'inv-1',
  orderId: 'order-1',
  amount: 500,
  razorpayPaymentLinkId: null as string | null,
  paymentLinkUrl: null as string | null,
  paymentLinkStatus: null as string | null,
  order: { customerId: 'customer-1' },
};

beforeEach(() => {
  mockReset(prismaMock);
  fetchPaymentLinkMock.mockReset();
  prismaMock.invoiceAdjustment.findMany.mockResolvedValue([]);
  prismaMock.payment.findMany.mockResolvedValue([]);
  prismaMock.paymentLinkTransition.findFirst.mockResolvedValue(null);
  prismaMock.paymentReconciliationException.findFirst.mockResolvedValue(null);
  prismaMock.paymentReconciliationException.create.mockResolvedValue({} as any);
  prismaMock.invoice.findUnique.mockResolvedValue(INVOICE_NO_LINK as any);
});

describe('checkPaymentLinkConsistency', () => {
  // Case 1, and the specific gap recoverStuckTransitions can't see: an
  // invoice with an outstanding balance, no razorpayPaymentLinkId at all,
  // and — critically — no PaymentLinkTransition row was ever created for
  // it either (distinguishing this from a crash-mid-flight case).
  it('flags an invoice with an outstanding balance and no payment link at all, even when no transition row ever existed', async () => {
    prismaMock.invoice.findMany.mockResolvedValueOnce([INVOICE_NO_LINK] as any).mockResolvedValueOnce([]);
    prismaMock.payment.findMany.mockResolvedValue([]); // nothing collected — full ₹500 outstanding

    const result = await checkPaymentLinkConsistency();

    expect(prismaMock.paymentLinkTransition.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ invoiceId: 'inv-1' }) })
    );
    expect(prismaMock.paymentReconciliationException.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ invoiceId: 'inv-1', customerId: 'customer-1', exceptionType: 'payment_link_inconsistent' }),
      })
    );
    expect(result.flagged).toBe(1);
  });

  it('does not flag an invoice that already has an open payment_link_inconsistent exception (no duplicate alerts)', async () => {
    prismaMock.invoice.findMany.mockResolvedValueOnce([INVOICE_NO_LINK] as any).mockResolvedValueOnce([]);
    prismaMock.paymentReconciliationException.findFirst.mockResolvedValue({ id: 'existing-exception' } as any);

    const result = await checkPaymentLinkConsistency();

    expect(prismaMock.paymentReconciliationException.create).not.toHaveBeenCalled();
    expect(result.flagged).toBe(0);
  });

  it('does not flag an invoice with a missing link if one is already fully settled (outstanding <= 0)', async () => {
    prismaMock.invoice.findMany.mockResolvedValueOnce([INVOICE_NO_LINK] as any).mockResolvedValueOnce([]);
    prismaMock.payment.findMany.mockResolvedValue([
      { paymentSource: 'cash', amountPaise: 50000n, allocatedPaise: 50000n },
    ] as any);

    const result = await checkPaymentLinkConsistency();

    expect(prismaMock.paymentReconciliationException.create).not.toHaveBeenCalled();
    expect(result.flagged).toBe(0);
  });

  it('does not flag an invoice with an in-progress PaymentLinkTransition — the stuck-transition recovery already owns that case', async () => {
    prismaMock.invoice.findMany.mockResolvedValueOnce([INVOICE_NO_LINK] as any).mockResolvedValueOnce([]);
    prismaMock.paymentLinkTransition.findFirst.mockResolvedValue({ id: 'in-progress' } as any);

    const result = await checkPaymentLinkConsistency();

    expect(prismaMock.paymentReconciliationException.create).not.toHaveBeenCalled();
    expect(result.flagged).toBe(0);
  });

  // Case 2: fully settled locally, but Razorpay still shows the link open —
  // must be verified live, never assumed from the local DB alone.
  it('flags a fully-settled invoice whose link Razorpay still reports as live', async () => {
    const invoiceWithLink = { ...INVOICE_NO_LINK, razorpayPaymentLinkId: 'plink_1', paymentLinkStatus: 'created' };
    prismaMock.invoice.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([invoiceWithLink] as any);
    prismaMock.payment.findMany.mockResolvedValue([
      { paymentSource: 'cash', amountPaise: 50000n, allocatedPaise: 50000n },
    ] as any);
    fetchPaymentLinkMock.mockResolvedValue({ success: true, status: 'created', amount: 50000 });

    const result = await checkPaymentLinkConsistency();

    expect(fetchPaymentLinkMock).toHaveBeenCalledWith('plink_1');
    expect(prismaMock.paymentReconciliationException.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ exceptionType: 'payment_link_inconsistent' }) })
    );
    expect(result.flagged).toBe(1);
  });

  // Case 3: partially settled, active link's live amount doesn't match the
  // current outstanding balance — only detectable via a live check, since
  // no link amount is stored locally at all.
  it('flags a partially-settled invoice whose active link amount does not match current outstanding', async () => {
    const invoiceWithLink = { ...INVOICE_NO_LINK, razorpayPaymentLinkId: 'plink_1', paymentLinkStatus: 'created' };
    prismaMock.invoice.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([invoiceWithLink] as any);
    // ₹200 collected of ₹500 — ₹300 (30000 paise) outstanding.
    prismaMock.payment.findMany.mockResolvedValue([
      { paymentSource: 'cash', amountPaise: 20000n, allocatedPaise: 20000n },
    ] as any);
    // Live link is still for the stale full ₹500 (50000 paise), not ₹300.
    fetchPaymentLinkMock.mockResolvedValue({ success: true, status: 'created', amount: 50000 });

    const result = await checkPaymentLinkConsistency();

    expect(prismaMock.paymentReconciliationException.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ exceptionType: 'payment_link_inconsistent' }) })
    );
    expect(result.flagged).toBe(1);
  });

  it('never flags anything it could not verify live (a failed fetch is skipped, not assumed)', async () => {
    const invoiceWithLink = { ...INVOICE_NO_LINK, razorpayPaymentLinkId: 'plink_1', paymentLinkStatus: 'created' };
    prismaMock.invoice.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([invoiceWithLink] as any);
    fetchPaymentLinkMock.mockResolvedValue({ success: false, error: 'timeout' });

    const result = await checkPaymentLinkConsistency();

    expect(prismaMock.paymentReconciliationException.create).not.toHaveBeenCalled();
    expect(result.flagged).toBe(0);
  });

  // Recovery/sweep invariant: never a write beyond the exception row itself.
  it('never calls cancelPaymentLink/createPaymentLink — read + flag only', async () => {
    const invoiceWithLink = { ...INVOICE_NO_LINK, razorpayPaymentLinkId: 'plink_1', paymentLinkStatus: 'created' };
    prismaMock.invoice.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([invoiceWithLink] as any);
    prismaMock.payment.findMany.mockResolvedValue([]);
    fetchPaymentLinkMock.mockResolvedValue({ success: true, status: 'cancelled', amount: 50000 });

    await checkPaymentLinkConsistency();

    // 'cancelled' is a terminal status (liveStillPayable=false) — case 2/3
    // branches both no-op for a terminal link regardless of outstanding.
    expect(prismaMock.paymentReconciliationException.create).not.toHaveBeenCalled();
  });
});
