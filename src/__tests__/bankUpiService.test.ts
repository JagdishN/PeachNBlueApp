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
import { reportBankUpiPayment, verifyBankUpiPayment, rejectBankUpiPayment, listPendingBankUpiPayments } from '../services/bankUpiService';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
  prismaMock.invoiceAdjustment.findMany.mockResolvedValue([]);
  retireOrReplaceLinkMock.mockReset().mockResolvedValue({ completed: true, newPaymentLinkId: null, newPaymentLinkUrl: null });
  prismaMock.$transaction.mockImplementation(((cb: any) => cb(prismaMock)) as any);
});

describe('reportBankUpiPayment (Stage A)', () => {
  const ORDER = { id: 'order-1', customerId: 'customer-1', staffId: 'staff-1', invoice: { id: 'invoice-1' } };

  it('rejects a missing/blank UTR', async () => {
    await expect(
      reportBankUpiPayment({ orderId: 'order-1', amount: 500, utrReference: '  ', reportedById: 'staff-1', role: 'staff' })
    ).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a non-positive amount', async () => {
    await expect(
      reportBankUpiPayment({ orderId: 'order-1', amount: 0, utrReference: 'UTR1', reportedById: 'staff-1', role: 'staff' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects with 404 when the order does not exist', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    await expect(
      reportBankUpiPayment({ orderId: 'missing', amount: 500, utrReference: 'UTR1', reportedById: 'staff-1', role: 'staff' })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects with 403 when a staff member reports for an order that isn't theirs", async () => {
    prismaMock.order.findUnique.mockResolvedValue(ORDER as any);
    await expect(
      reportBankUpiPayment({ orderId: 'order-1', amount: 500, utrReference: 'UTR1', reportedById: 'staff-2', role: 'staff' })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects with 409 when the order has no invoice', async () => {
    prismaMock.order.findUnique.mockResolvedValue({ ...ORDER, invoice: null } as any);
    await expect(
      reportBankUpiPayment({ orderId: 'order-1', amount: 500, utrReference: 'UTR1', reportedById: 'staff-1', role: 'staff' })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('creates a PENDING, zero-allocated Payment row with the UTR, not auto-verified', async () => {
    prismaMock.order.findUnique.mockResolvedValue(ORDER as any);
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'invoice-1', orderId: 'order-1', amount: 500 } as any);
    prismaMock.payment.findMany.mockResolvedValue([]);
    prismaMock.payment.findFirst.mockResolvedValue(null); // no existing UTR match
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-1', amountPaise: 50000n, allocatedPaise: 0n } as any);

    await reportBankUpiPayment({ orderId: 'order-1', amount: 500, utrReference: 'UTR-ABC-123', reportedById: 'staff-1', role: 'staff' });

    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentSource: 'bank_upi',
          verificationStatus: 'pending',
          allocatedPaise: 0n,
          utrReference: 'UTR-ABC-123',
          isDuplicateUtrSuspected: false,
        }),
      })
    );
  });

  // Spec section 3/7: flag, never hard-block, a reused UTR.
  it('flags isDuplicateUtrSuspected when the same UTR already exists on another bank_upi payment', async () => {
    prismaMock.order.findUnique.mockResolvedValue(ORDER as any);
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'invoice-1', orderId: 'order-1', amount: 500 } as any);
    prismaMock.payment.findMany.mockResolvedValue([]);
    prismaMock.payment.findFirst.mockResolvedValue({ id: 'other-payment', utrReference: 'UTR-ABC-123' } as any);
    prismaMock.payment.create.mockResolvedValue({ id: 'payment-2', amountPaise: 50000n, allocatedPaise: 0n } as any);

    await reportBankUpiPayment({ orderId: 'order-1', amount: 500, utrReference: 'UTR-ABC-123', reportedById: 'staff-1', role: 'staff' });

    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isDuplicateUtrSuspected: true }) })
    );
  });
});

describe('verifyBankUpiPayment (Stage B)', () => {
  it('rejects with 404 when the payment report does not exist', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(null);
    await expect(verifyBankUpiPayment('missing', 'admin-1')).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a payment that is not a bank_upi report', async () => {
    prismaMock.payment.findUnique.mockResolvedValue({ id: 'payment-1', paymentSource: 'cash' } as any);
    await expect(verifyBankUpiPayment('payment-1', 'admin-1')).rejects.toMatchObject({ status: 400 });
  });

  it('promotes the payment to verified, allocates it, and retires/replaces the Razorpay link', async () => {
    prismaMock.payment.findUnique
      .mockResolvedValueOnce({ id: 'payment-1', paymentSource: 'bank_upi', invoiceId: 'invoice-1' } as any)
      .mockResolvedValueOnce({
        id: 'payment-1',
        invoiceId: 'invoice-1',
        orderId: 'order-1',
        customerId: 'customer-1',
        amountPaise: 50000n,
        verificationStatus: 'pending',
      } as any);
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'invoice-1', amount: 500 } as any);
    // First read (before promoting) sees nothing allocated yet; every read
    // after the promotion (recalculateInvoiceStatus, then its own final
    // summary) sees the now-allocated payment — mirrors a real
    // transaction's later reads seeing its own earlier write.
    prismaMock.payment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ paymentSource: 'bank_upi', amountPaise: 50000n, allocatedPaise: 50000n }] as any);

    const summary = await verifyBankUpiPayment('payment-1', 'admin-1');

    expect(prismaMock.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'payment-1' },
        data: expect.objectContaining({ verificationStatus: 'verified', verifiedById: 'admin-1', allocatedPaise: 50000n }),
      })
    );
    expect(summary.status).toBe('paid');
    expect(retireOrReplaceLinkMock).toHaveBeenCalledWith('invoice-1', 'bank_upi_full', 'admin-1');
    expect(prismaMock.paymentAllocation.create).toHaveBeenCalledWith({
      data: { paymentId: 'payment-1', invoiceId: 'invoice-1', allocatedPaise: 50000n },
    });
  });

  // Mandatory test #18: an already-verified payment can't be verified
  // (and therefore allocated) a second time.
  it('rejects verifying a payment that is already verified, rather than allocating it twice', async () => {
    prismaMock.payment.findUnique.mockResolvedValue({
      id: 'payment-1',
      paymentSource: 'bank_upi',
      invoiceId: 'invoice-1',
      verificationStatus: 'verified',
    } as any);

    await expect(verifyBankUpiPayment('payment-1', 'admin-1')).rejects.toThrow('not pending verification');
    expect(prismaMock.payment.update).not.toHaveBeenCalled();
  });

  it('uses bank_upi_partial as the lifecycle reason when a balance remains', async () => {
    prismaMock.payment.findUnique
      .mockResolvedValueOnce({ id: 'payment-1', paymentSource: 'bank_upi', invoiceId: 'invoice-1' } as any)
      .mockResolvedValueOnce({
        id: 'payment-1',
        invoiceId: 'invoice-1',
        orderId: 'order-1',
        customerId: 'customer-1',
        amountPaise: 30000n,
        verificationStatus: 'pending',
      } as any);
    prismaMock.invoice.findUnique.mockResolvedValue({ id: 'invoice-1', amount: 880 } as any);
    prismaMock.payment.findMany.mockResolvedValue([]);

    await verifyBankUpiPayment('payment-1', 'admin-1');

    expect(retireOrReplaceLinkMock).toHaveBeenCalledWith('invoice-1', 'bank_upi_partial', 'admin-1');
  });
});

describe('rejectBankUpiPayment', () => {
  it('rejects with 404 when the payment report does not exist', async () => {
    prismaMock.payment.findUnique.mockResolvedValue(null);
    await expect(rejectBankUpiPayment('missing', 'admin-1', 'UTR not found in statement')).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a payment that is not pending', async () => {
    prismaMock.payment.findUnique.mockResolvedValue({ id: 'payment-1', verificationStatus: 'verified' } as any);
    await expect(rejectBankUpiPayment('payment-1', 'admin-1', 'reason')).rejects.toMatchObject({ status: 400 });
  });

  it('marks a pending report as rejected without touching the ledger', async () => {
    prismaMock.payment.findUnique.mockResolvedValue({ id: 'payment-1', verificationStatus: 'pending', notes: null } as any);
    prismaMock.payment.update.mockResolvedValue({} as any);

    await rejectBankUpiPayment('payment-1', 'admin-1', 'UTR not found in bank statement');

    expect(prismaMock.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'payment-1' },
        data: expect.objectContaining({ verificationStatus: 'rejected', verifiedById: 'admin-1' }),
      })
    );
  });
});

describe('listPendingBankUpiPayments', () => {
  it('queries only pending bank_upi payments, oldest first', async () => {
    prismaMock.payment.findMany.mockResolvedValue([] as any);

    await listPendingBankUpiPayments();

    expect(prismaMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paymentSource: 'bank_upi', verificationStatus: 'pending' },
        orderBy: { createdAt: 'asc' },
      })
    );
  });

  it('scopes to a branch when given', async () => {
    prismaMock.payment.findMany.mockResolvedValue([] as any);

    await listPendingBankUpiPayments('branch-1');

    expect(prismaMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paymentSource: 'bank_upi', verificationStatus: 'pending', customer: { branchId: 'branch-1' } },
      })
    );
  });
});
