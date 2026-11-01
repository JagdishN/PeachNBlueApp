import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

const createPaymentLinkMock = jest.fn();
const cancelPaymentLinkMock = jest.fn();
jest.mock('../lib/razorpayClient', () => ({
  createPaymentLink: (...args: unknown[]) => createPaymentLinkMock(...args),
  cancelPaymentLink: (...args: unknown[]) => cancelPaymentLinkMock(...args),
}));

import prisma from '../prisma/client';
import { retireOrReplaceLink, recoverStuckTransitions } from '../services/paymentLinkLifecycle';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const INVOICE_BASE = {
  id: 'inv-1',
  orderId: 'order-1',
  amount: 500,
  razorpayPaymentLinkId: null as string | null,
  paymentLinkUrl: null as string | null,
  order: {
    orderNumber: 'PB-TEST',
    customerId: 'customer-1',
    customer: { fullName: 'Test Customer', phoneNumber: '9999999999' },
  },
};

beforeEach(() => {
  mockReset(prismaMock);
  prismaMock.invoiceAdjustment.findMany.mockResolvedValue([]);
  createPaymentLinkMock.mockReset();
  cancelPaymentLinkMock.mockReset();
  prismaMock.paymentLinkTransition.create.mockResolvedValue({ id: 'transition-1' } as any);
  prismaMock.paymentLinkTransition.update.mockResolvedValue({} as any);
  prismaMock.paymentLinkHistory.create.mockResolvedValue({} as any);
  prismaMock.paymentReconciliationException.create.mockResolvedValue({} as any);
  prismaMock.invoice.update.mockResolvedValue({} as any);
  prismaMock.payment.findMany.mockResolvedValue([]);
});

describe('retireOrReplaceLink', () => {
  it('throws when the invoice does not exist', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(null);
    await expect(retireOrReplaceLink('missing', 'cash_full', 'staff-1')).rejects.toThrow('not found');
  });

  it('creates a fresh link for the full outstanding amount when there was no prior link', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(INVOICE_BASE as any);
    createPaymentLinkMock.mockResolvedValue({
      success: true,
      link: { id: 'plink_new', shortUrl: 'https://rzp.io/l/new' },
    });

    const result = await retireOrReplaceLink('inv-1', 'reissue', 'staff-1');

    expect(cancelPaymentLinkMock).not.toHaveBeenCalled();
    expect(createPaymentLinkMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 500 }));
    expect(result).toEqual({ completed: true, newPaymentLinkId: 'plink_new', newPaymentLinkUrl: 'https://rzp.io/l/new' });
    expect(prismaMock.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: { razorpayPaymentLinkId: 'plink_new', paymentLinkUrl: 'https://rzp.io/l/new', paymentLinkStatus: 'created' },
      })
    );
  });

  it('cancels the old link, then creates a replacement for the reduced outstanding balance after a partial cash payment', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...INVOICE_BASE,
      razorpayPaymentLinkId: 'plink_old',
      paymentLinkUrl: 'https://rzp.io/l/old',
      amount: 880,
    } as any);
    cancelPaymentLinkMock.mockResolvedValue({ success: true, uncertain: false });
    createPaymentLinkMock.mockResolvedValue({
      success: true,
      link: { id: 'plink_new', shortUrl: 'https://rzp.io/l/new' },
    });
    // After a ₹300 cash payment, ₹580 remains outstanding.
    prismaMock.payment.findMany.mockResolvedValue([
      { paymentSource: 'cash', amountPaise: 30000n, allocatedPaise: 30000n },
    ] as any);

    const result = await retireOrReplaceLink('inv-1', 'cash_partial', 'staff-1');

    expect(cancelPaymentLinkMock).toHaveBeenCalledWith('plink_old');
    expect(createPaymentLinkMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 580 }));
    expect(result.completed).toBe(true);
    expect(prismaMock.paymentLinkHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ razorpayPaymentLinkId: 'plink_old', finalStatus: 'cancelled' }) })
    );
  });

  it('creates no replacement link when the outstanding balance is fully settled', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...INVOICE_BASE,
      razorpayPaymentLinkId: 'plink_old',
      amount: 500,
    } as any);
    cancelPaymentLinkMock.mockResolvedValue({ success: true, uncertain: false });
    prismaMock.payment.findMany.mockResolvedValue([
      { paymentSource: 'cash', amountPaise: 50000n, allocatedPaise: 50000n },
    ] as any);

    const result = await retireOrReplaceLink('inv-1', 'cash_full', 'staff-1');

    expect(createPaymentLinkMock).not.toHaveBeenCalled();
    expect(result).toEqual({ completed: true, newPaymentLinkId: null, newPaymentLinkUrl: null });
    expect(prismaMock.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { paymentLinkStatus: 'paid' } })
    );
  });

  // Payment-safety review 4.3: "do not create the replacement link while
  // the previous link remains in an unresolved payable state." An
  // uncertain cancellation must NOT be treated as success, and must NOT
  // proceed to create a second, possibly-duplicate link.
  it('does not create a replacement link when the old link cancellation is uncertain, and opens a reconciliation exception', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...INVOICE_BASE,
      razorpayPaymentLinkId: 'plink_old',
      amount: 880,
    } as any);
    cancelPaymentLinkMock.mockResolvedValue({ success: false, uncertain: true, error: 'timeout' });

    const result = await retireOrReplaceLink('inv-1', 'cash_partial', 'staff-1');

    expect(createPaymentLinkMock).not.toHaveBeenCalled();
    expect(result).toEqual({ completed: false, newPaymentLinkId: null, newPaymentLinkUrl: null });
    expect(prismaMock.paymentLinkTransition.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed_needs_review' }) })
    );
    expect(prismaMock.paymentReconciliationException.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ invoiceId: 'inv-1', exceptionType: 'cancellation_uncertain' }),
      })
    );
    // The invoice's link fields are left untouched — never falsely claim
    // the old link was safely disabled.
    expect(prismaMock.invoice.update).not.toHaveBeenCalled();
  });

  // Real bug fixed (2026-11-01): createPaymentLink failing used to throw
  // straight out of this function — uncaught all the way through
  // orderService.ts::recordPayment (which, by this point, had already
  // durably committed the real cash Payment row in its own transaction) to
  // the Express handler, surfacing as a bare 500 to staff for a payment
  // that actually succeeded. Must behave like the cancel-uncertain case
  // above: completed: false, a flagged transition, never a thrown error.
  it('does not throw when replacement link creation fails, flags the transition, and opens a reconciliation exception', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...INVOICE_BASE,
      razorpayPaymentLinkId: 'plink_old',
      amount: 880,
    } as any);
    cancelPaymentLinkMock.mockResolvedValue({ success: true, uncertain: false });
    createPaymentLinkMock.mockResolvedValue({ success: false, link: null, error: 'Razorpay: invalid request' });
    // After a ₹300 cash payment, ₹580 remains outstanding — still > 0, so a
    // replacement link is attempted (and fails) rather than skipped.
    prismaMock.payment.findMany.mockResolvedValue([
      { paymentSource: 'cash', amountPaise: 30000n, allocatedPaise: 30000n },
    ] as any);

    const result = await retireOrReplaceLink('inv-1', 'cash_partial', 'staff-1');

    expect(result).toEqual({ completed: false, newPaymentLinkId: null, newPaymentLinkUrl: null });
    expect(prismaMock.paymentLinkTransition.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed_needs_review', errorDetail: 'Razorpay: invalid request' }),
      })
    );
    // Payment-safety corrections (2026-11-01): this is the branch a cash
    // payment with a remaining balance actually exercises, and it used to
    // have no Admin-visible surface at all — only a raw PaymentLinkTransition
    // row with no dedicated screen. Now opens a link_creation_failed
    // reconciliation exception, same as the cancel-uncertain case, so it
    // shows up on PaymentReconciliationScreen.
    expect(prismaMock.paymentReconciliationException.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ invoiceId: 'inv-1', exceptionType: 'link_creation_failed' }),
      })
    );
    // The invoice was already left link-free by the successful cancel step
    // above (called once, for that) — no SECOND invoice update for the
    // (failed) replacement-link step, and nothing stale/incorrect left on
    // the row either way.
    expect(prismaMock.invoice.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { razorpayPaymentLinkId: null, paymentLinkUrl: null, paymentLinkStatus: 'cancelled' },
      })
    );
  });

  // Payment-safety corrections (2026-11-01): a failure persisting the
  // reconciliation exception itself must never escape this function — the
  // caller's real operation (e.g. an already-committed cash payment) must
  // never be turned into a failure by this secondary safety-net write.
  it('does not throw when persisting the link_creation_failed exception itself fails', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...INVOICE_BASE,
      razorpayPaymentLinkId: 'plink_old',
      amount: 880,
    } as any);
    cancelPaymentLinkMock.mockResolvedValue({ success: true, uncertain: false });
    createPaymentLinkMock.mockResolvedValue({ success: false, link: null, error: 'Razorpay: invalid request' });
    prismaMock.payment.findMany.mockResolvedValue([
      { paymentSource: 'cash', amountPaise: 30000n, allocatedPaise: 30000n },
    ] as any);
    prismaMock.paymentReconciliationException.create.mockRejectedValue(new Error('DB unavailable'));

    await expect(retireOrReplaceLink('inv-1', 'cash_partial', 'staff-1')).resolves.toEqual({
      completed: false,
      newPaymentLinkId: null,
      newPaymentLinkUrl: null,
    });
  });
});

describe('recoverStuckTransitions', () => {
  it('re-runs retireOrReplaceLink for every transition stuck in a non-terminal state past the staleness window', async () => {
    prismaMock.paymentLinkTransition.findMany.mockResolvedValue([
      { id: 't-1', invoiceId: 'inv-1', reason: 'cash_full', triggeredById: 'staff-1', status: 'pending' },
    ] as any);
    prismaMock.invoice.findUnique.mockResolvedValue({ ...INVOICE_BASE, amount: 500 } as any);
    prismaMock.payment.findMany.mockResolvedValue([
      { paymentSource: 'cash', amountPaise: 50000n, allocatedPaise: 50000n },
    ] as any);

    const result = await recoverStuckTransitions(15);

    expect(result).toEqual({ recovered: 1, stillStuck: 0 });
  });

  it('counts a transition as stillStuck (and flags it) when recovery itself throws', async () => {
    prismaMock.paymentLinkTransition.findMany.mockResolvedValue([
      { id: 't-1', invoiceId: 'missing-invoice', reason: 'cash_full', triggeredById: 'staff-1', status: 'pending' },
    ] as any);
    prismaMock.invoice.findUnique.mockResolvedValue(null);

    const result = await recoverStuckTransitions(15);

    expect(result).toEqual({ recovered: 0, stillStuck: 1 });
    expect(prismaMock.paymentLinkTransition.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't-1' }, data: expect.objectContaining({ status: 'failed_needs_review' }) })
    );
  });

  it('does nothing when no transitions are stuck', async () => {
    prismaMock.paymentLinkTransition.findMany.mockResolvedValue([]);

    const result = await recoverStuckTransitions(15);

    expect(result).toEqual({ recovered: 0, stillStuck: 0 });
  });

  // Payment-safety corrections (2026-11-01): a transition that keeps
  // failing would otherwise be retried every 10 minutes forever, with no
  // human ever told. Past the 2-hour bound, escalate instead of retrying.
  it('escalates (without retrying) a transition stuck for longer than the retry bound, and opens an exception', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    prismaMock.paymentLinkTransition.findMany.mockResolvedValue([
      { id: 't-1', invoiceId: 'inv-1', reason: 'cash_full', triggeredById: 'staff-1', status: 'pending', createdAt: threeHoursAgo },
    ] as any);
    prismaMock.invoice.findUnique.mockResolvedValue({ ...INVOICE_BASE, order: { customerId: 'customer-1' } } as any);

    const result = await recoverStuckTransitions(15);

    expect(result).toEqual({ recovered: 0, stillStuck: 1 });
    expect(createPaymentLinkMock).not.toHaveBeenCalled();
    expect(cancelPaymentLinkMock).not.toHaveBeenCalled();
    expect(prismaMock.paymentLinkTransition.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't-1' }, data: expect.objectContaining({ status: 'failed_needs_review' }) })
    );
    expect(prismaMock.paymentReconciliationException.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ invoiceId: 'inv-1', exceptionType: 'link_creation_failed' }) })
    );
  });
});
