import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

const retireOrReplaceLinkMock = jest.fn().mockResolvedValue({ completed: true, newPaymentLinkId: null, newPaymentLinkUrl: null });
jest.mock('../services/paymentLinkLifecycle', () => ({
  retireOrReplaceLink: (...args: unknown[]) => retireOrReplaceLinkMock(...args),
}));

import prisma from '../prisma/client';
import { closeOutstandingBalance, reverseAdjustment, ReasonCategory } from '../services/invoiceAdjustmentService';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const INVOICE_WITH_ORDER = {
  id: 'inv-1',
  amount: 500,
  razorpayPaymentLinkId: null as string | null,
  order: { id: 'order-1', billingMode: 'daily' },
};

beforeEach(() => {
  mockReset(prismaMock);
  retireOrReplaceLinkMock.mockClear().mockResolvedValue({ completed: true, newPaymentLinkId: null, newPaymentLinkUrl: null });
  prismaMock.$transaction.mockImplementation(((cb: any) => cb(prismaMock)) as any);
  prismaMock.invoiceAdjustment.findUnique.mockResolvedValue(null);
  prismaMock.invoice.findUnique.mockResolvedValue(INVOICE_WITH_ORDER as any);
  prismaMock.payment.findFirst.mockResolvedValue(null); // no pending verification
  prismaMock.paymentLinkTransition.findFirst.mockResolvedValue(null); // no in-flight transition
  // Example from the spec: ₹500 invoice, ₹400 collected (one verified cash payment).
  prismaMock.payment.findMany.mockResolvedValue([
    { paymentSource: 'cash', amountPaise: 40000n, allocatedPaise: 40000n, verificationStatus: 'verified', status: 'success' },
  ] as any);
  prismaMock.invoiceAdjustment.findMany.mockResolvedValue([]);
  prismaMock.invoiceAdjustment.create.mockResolvedValue({ id: 'adj-1' } as any);
  prismaMock.invoice.update.mockResolvedValue({} as any);
  prismaMock.order.update.mockResolvedValue({} as any);
});

describe('closeOutstandingBalance', () => {
  const baseInput = { invoiceId: 'inv-1', adminId: 'admin-1', reasonCategory: 'goodwill' as ReasonCategory, reason: 'Customer goodwill' };

  it('rejects an invalid reasonCategory', async () => {
    await expect(closeOutstandingBalance({ ...baseInput, reasonCategory: 'bogus' as ReasonCategory })).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an empty reason', async () => {
    await expect(closeOutstandingBalance({ ...baseInput, reason: '   ' })).rejects.toMatchObject({ status: 400 });
  });

  // Spec section 2: "Do not include 'Payment received externally' as a waiver reason."
  it('rejects a reason describing an external payment', async () => {
    await expect(
      closeOutstandingBalance({ ...baseInput, reason: 'Customer paid externally via bank transfer' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('404s when the invoice does not exist', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(null);
    await expect(closeOutstandingBalance(baseInput)).rejects.toMatchObject({ status: 404 });
  });

  it('400s for a monthly-billing order — that balance is settled via the ledger, not a waiver', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ ...INVOICE_WITH_ORDER, order: { id: 'order-1', billingMode: 'monthly_billing' } } as any);
    await expect(closeOutstandingBalance(baseInput)).rejects.toMatchObject({ status: 400 });
  });

  // Spec step 6 / mandatory test #9: "Reject or defer closure if conflicting collections are being reconciled."
  it('409s with PENDING_VERIFICATION when a payment on the invoice is still unverified', async () => {
    prismaMock.payment.findFirst.mockResolvedValue({ id: 'pay-pending' } as any);
    await expect(closeOutstandingBalance(baseInput)).rejects.toMatchObject({ status: 409, code: 'PENDING_VERIFICATION' });
  });

  it('409s when a payment-link transition is already in progress for this invoice', async () => {
    prismaMock.paymentLinkTransition.findFirst.mockResolvedValue({ id: 'transition-pending' } as any);
    await expect(closeOutstandingBalance(baseInput)).rejects.toMatchObject({ status: 409, code: 'LINK_TRANSITION_IN_PROGRESS' });
  });

  it('400s when the invoice has nothing outstanding to close', async () => {
    prismaMock.payment.findMany.mockResolvedValue([
      { paymentSource: 'cash', amountPaise: 50000n, allocatedPaise: 50000n, verificationStatus: 'verified', status: 'success' },
    ] as any);
    await expect(closeOutstandingBalance(baseInput)).rejects.toMatchObject({ status: 400 });
  });

  // Mandatory tests #1, #3, #4, #5: closes a partially paid invoice without
  // creating a Payment, leaves the original amount untouched, and zeroes
  // the outstanding balance.
  it('closes a partially paid invoice, waiving exactly the current outstanding balance', async () => {
    // Second read (inside recalculateInvoiceStatus, after the create) sees
    // the just-created adjustment — same "mock doesn't reflect its own
    // write" workaround used elsewhere in this test suite.
    prismaMock.invoiceAdjustment.findMany.mockResolvedValueOnce([]).mockResolvedValue([{ amountPaise: 10000n }] as any);

    const result = await closeOutstandingBalance(baseInput);

    expect(result.outstandingBefore).toBe(100);
    expect(result.waivedAmount).toBe(100);
    expect(result.outstandingAfter).toBe(0);
    expect(result.linkLifecycle).toBe('not_applicable');
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
    expect(prismaMock.invoiceAdjustment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceId: 'inv-1',
        adjustmentType: 'waiver',
        amountPaise: 10000n,
        reasonCategory: 'goodwill',
        reason: 'Customer goodwill',
        createdById: 'admin-1',
      }),
    });
  });

  it('is idempotent — a repeated call with the same idempotencyKey returns the prior result without creating a second waiver', async () => {
    prismaMock.invoiceAdjustment.findUnique.mockResolvedValue({ id: 'adj-existing', invoiceId: 'inv-1', amountPaise: 10000n } as any);

    const result = await closeOutstandingBalance({ ...baseInput, idempotencyKey: 'key-1' });

    expect(result.adjustmentId).toBe('adj-existing');
    expect(prismaMock.invoiceAdjustment.create).not.toHaveBeenCalled();
  });

  // Mandatory test #9 (safe side): a real Razorpay link gets retired
  // through the centralized lifecycle, after the money-side transaction
  // already committed.
  it('retires an active Razorpay link through the centralized lifecycle after committing the waiver', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ ...INVOICE_WITH_ORDER, razorpayPaymentLinkId: 'link-abc' } as any);
    prismaMock.invoiceAdjustment.findMany.mockResolvedValueOnce([]).mockResolvedValue([{ amountPaise: 10000n }] as any);
    prismaMock.paymentLinkTransition.findFirst.mockResolvedValueOnce(null).mockResolvedValue({ id: 'transition-1' } as any);

    const result = await closeOutstandingBalance(baseInput);

    expect(retireOrReplaceLinkMock).toHaveBeenCalledWith('inv-1', 'admin_waiver', 'admin-1');
    expect(result.linkLifecycle).toBe('completed');
    expect(prismaMock.invoiceAdjustment.update).toHaveBeenCalledWith({
      where: { id: 'adj-1' },
      data: { linkTransitionId: 'transition-1' },
    });
  });

  // Mandatory test #10: an uncertain/late provider result never claims
  // false success.
  it('surfaces needs_review, not a hard failure, when link cancellation is uncertain', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ ...INVOICE_WITH_ORDER, razorpayPaymentLinkId: 'link-abc' } as any);
    prismaMock.invoiceAdjustment.findMany.mockResolvedValueOnce([]).mockResolvedValue([{ amountPaise: 10000n }] as any);
    retireOrReplaceLinkMock.mockResolvedValue({ completed: false, newPaymentLinkId: null, newPaymentLinkUrl: null });

    const result = await closeOutstandingBalance(baseInput);

    expect(result.linkLifecycle).toBe('needs_review');
  });
});

describe('reverseAdjustment', () => {
  const baseInput = { invoiceId: 'inv-1', adjustmentId: 'adj-1', adminId: 'admin-2', reversalReason: 'Closed the wrong invoice' };
  const ACTIVE_ADJUSTMENT = { id: 'adj-1', invoiceId: 'inv-1', amountPaise: 10000n, reversedAt: null };

  beforeEach(() => {
    prismaMock.invoiceAdjustment.findUnique.mockResolvedValue(ACTIVE_ADJUSTMENT as any);
    prismaMock.invoiceAdjustment.update.mockResolvedValue({} as any);
  });

  it('rejects a missing reversal reason', async () => {
    await expect(reverseAdjustment({ ...baseInput, reversalReason: '' })).rejects.toMatchObject({ status: 400 });
  });

  it('404s when the adjustment does not exist, or belongs to a different invoice', async () => {
    prismaMock.invoiceAdjustment.findUnique.mockResolvedValue(null);
    await expect(reverseAdjustment(baseInput)).rejects.toMatchObject({ status: 404 });

    prismaMock.invoiceAdjustment.findUnique.mockResolvedValue({ ...ACTIVE_ADJUSTMENT, invoiceId: 'some-other-invoice' } as any);
    await expect(reverseAdjustment(baseInput)).rejects.toMatchObject({ status: 404 });
  });

  it('409s when the adjustment was already reversed', async () => {
    prismaMock.invoiceAdjustment.findUnique.mockResolvedValue({ ...ACTIVE_ADJUSTMENT, reversedAt: new Date() } as any);
    await expect(reverseAdjustment(baseInput)).rejects.toMatchObject({ status: 409 });
  });

  // Mandatory test #11: reversal restores the correct outstanding amount,
  // without deleting the original adjustment (stamped, not removed).
  it('reverses the waiver and restores the outstanding balance', async () => {
    // First summary read (before reversal) still sees the active waiver;
    // the final read (after) sees it excluded.
    prismaMock.invoiceAdjustment.findMany.mockResolvedValueOnce([{ amountPaise: 10000n }] as any).mockResolvedValue([] as any);

    const result = await reverseAdjustment(baseInput);

    expect(result.outstandingBefore).toBe(0);
    expect(result.outstandingAfter).toBe(100);
    expect(prismaMock.invoiceAdjustment.update).toHaveBeenCalledWith({
      where: { id: 'adj-1' },
      data: { reversedAt: expect.any(Date), reversedById: 'admin-2', reversalReason: 'Closed the wrong invoice' },
    });
    // A fresh link is issued through the centralized lifecycle, never by
    // resurrecting the old (already-cancelled) one.
    expect(retireOrReplaceLinkMock).toHaveBeenCalledWith('inv-1', 'adjustment_reversal', 'admin-2');
  });
});
