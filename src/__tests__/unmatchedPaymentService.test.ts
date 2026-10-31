import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { Prisma, PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from '../prisma/client';
import { recordUnmatchedPayment, listUnmatchedPayments, resolveUnmatchedPayment } from '../services/unmatchedPaymentService';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
});

describe('recordUnmatchedPayment', () => {
  it('persists a new unmatched payment with the raw payload and paise amount as given', async () => {
    await recordUnmatchedPayment({
      razorpayPaymentId: 'pay_1',
      razorpayPaymentLinkId: 'plink_1',
      amountPaise: 49900n,
      rawPayload: { event: 'payment_link.paid' },
    });

    expect(prismaMock.unmatchedProviderPayment.create).toHaveBeenCalledWith({
      data: {
        razorpayPaymentId: 'pay_1',
        razorpayPaymentLinkId: 'plink_1',
        amountPaise: 49900n,
        rawPayload: { event: 'payment_link.paid' },
      },
    });
  });

  // Required test #6/#9 combined for this path specifically: a redelivered
  // webhook for a payment that's already in the unmatched queue must not
  // create a second row — the DB's unique constraint on razorpayPaymentId
  // is the real backstop, this just confirms the resulting P2002 is
  // swallowed as benign rather than surfaced as a failure.
  it('swallows a duplicate-key (P2002) error as a benign no-op — same payment already queued', async () => {
    prismaMock.unmatchedProviderPayment.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`razorpay_payment_id`)', {
        code: 'P2002',
        clientVersion: '5.0.0',
      })
    );

    await expect(
      recordUnmatchedPayment({
        razorpayPaymentId: 'pay_1',
        razorpayPaymentLinkId: 'plink_1',
        amountPaise: 49900n,
        rawPayload: {},
      })
    ).resolves.toBeUndefined();
  });

  // Required: "do not acknowledge a webhook as successfully processed if a
  // recoverable database failure prevented durable recording — allow safe
  // retries." Anything other than the duplicate-key case must rethrow so the
  // caller (webhookController) does NOT ack 200, letting Razorpay retry.
  it('rethrows any error that is not a P2002 duplicate', async () => {
    prismaMock.unmatchedProviderPayment.create.mockRejectedValue(new Error('connection reset'));

    await expect(
      recordUnmatchedPayment({
        razorpayPaymentId: 'pay_1',
        razorpayPaymentLinkId: 'plink_1',
        amountPaise: 49900n,
        rawPayload: {},
      })
    ).rejects.toThrow('connection reset');
  });
});

describe('listUnmatchedPayments', () => {
  it('defaults to filtering by the given status', async () => {
    await listUnmatchedPayments('unresolved');
    expect(prismaMock.unmatchedProviderPayment.findMany).toHaveBeenCalledWith({
      where: { status: 'unresolved' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns every row, unfiltered, when status is "all"', async () => {
    await listUnmatchedPayments('all');
    expect(prismaMock.unmatchedProviderPayment.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('resolveUnmatchedPayment', () => {
  it('returns null when the row does not exist', async () => {
    prismaMock.unmatchedProviderPayment.findUnique.mockResolvedValue(null);
    const result = await resolveUnmatchedPayment('missing-id', 'resolved', 'notes', 'admin-1');
    expect(result).toBeNull();
  });

  it('stamps resolvedBy/resolvedAt and the given notes', async () => {
    prismaMock.unmatchedProviderPayment.findUnique.mockResolvedValue({ id: 'u-1', resolutionNotes: null } as any);

    await resolveUnmatchedPayment('u-1', 'resolved', 'Matched manually to order #123', 'admin-1');

    expect(prismaMock.unmatchedProviderPayment.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: {
        status: 'resolved',
        resolutionNotes: 'Matched manually to order #123',
        resolvedById: 'admin-1',
        resolvedAt: expect.any(Date),
      },
    });
  });
});
