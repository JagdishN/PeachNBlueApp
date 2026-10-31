import 'express-async-errors';
import express from 'express';
import request from 'supertest';
import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { Prisma, PrismaClient } from '@prisma/client';

const { PrismaClientKnownRequestError } = Prisma;

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

jest.mock('../lib/razorpayClient', () => ({
  verifyWebhookSignature: jest.fn(),
}));

jest.mock('../services/orderService', () => ({
  recordOnlinePayment: jest.fn(),
}));

import prisma from '../prisma/client';
import { verifyWebhookSignature } from '../lib/razorpayClient';
import { recordOnlinePayment } from '../services/orderService';
import { errorHandler } from '../middleware/errorHandler';
import webhookRoutes from '../routes/webhooks';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const verifySignatureMock = verifyWebhookSignature as jest.Mock;
const recordOnlinePaymentMock = recordOnlinePayment as jest.Mock;

// Mirrors server.ts: webhooks route mounted with express.raw(), no
// express.json() anywhere in this app — matches the real requirement that
// the raw body must survive untouched for signature verification.
const app = express();
app.use('/api/v1/webhooks', webhookRoutes);
app.use(errorHandler);

const paymentLinkPaidPayload = {
  event: 'payment_link.paid',
  payload: {
    payment_link: { entity: { id: 'plink_abc123' } },
    payment: { entity: { id: 'pay_xyz789', method: 'upi', amount: 49900 } },
  },
};

beforeEach(() => {
  mockReset(prismaMock);
  verifySignatureMock.mockReset().mockReturnValue(true);
  recordOnlinePaymentMock.mockReset().mockResolvedValue({ status: 'paid' });
});

describe('POST /razorpay — signature verification', () => {
  it('rejects a request with no signature header, without even calling verifyWebhookSignature (short-circuits on the missing header)', async () => {
    const res = await request(app).post('/api/v1/webhooks/razorpay').send(paymentLinkPaidPayload);

    expect(res.status).toBe(400);
    expect(verifySignatureMock).not.toHaveBeenCalled();
  });

  it('rejects a request when verifyWebhookSignature returns false', async () => {
    verifySignatureMock.mockReturnValue(false);

    const res = await request(app)
      .post('/api/v1/webhooks/razorpay')
      .set('x-razorpay-signature', 'bad-signature')
      .send(paymentLinkPaidPayload);

    expect(res.status).toBe(400);
    expect(prismaMock.invoice.findFirst).not.toHaveBeenCalled();
  });

  it('verifies against the raw body, not a re-serialized/parsed version', async () => {
    await request(app)
      .post('/api/v1/webhooks/razorpay')
      .set('x-razorpay-signature', 'sig123')
      .send(paymentLinkPaidPayload);

    const [rawBodyArg, signatureArg] = verifySignatureMock.mock.calls[0];
    expect(signatureArg).toBe('sig123');
    expect(JSON.parse(rawBodyArg)).toEqual(paymentLinkPaidPayload);
  });
});

describe('POST /razorpay — payment_link.paid', () => {
  it('looks up the invoice by razorpayPaymentLinkId and records the payment, mapping upi correctly', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue({ id: 'inv-1', orderId: 'order-1' } as any);

    const res = await request(app)
      .post('/api/v1/webhooks/razorpay')
      .set('x-razorpay-signature', 'sig123')
      .send(paymentLinkPaidPayload);

    expect(res.status).toBe(200);
    expect(prismaMock.invoice.findFirst).toHaveBeenCalledWith({ where: { razorpayPaymentLinkId: 'plink_abc123' } });
    expect(recordOnlinePaymentMock).toHaveBeenCalledWith('order-1', 'upi', 499, 'pay_xyz789', 'upi');
  });

  it('maps card -> credit_card and netbanking -> net_banking', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue({ id: 'inv-1', orderId: 'order-1' } as any);

    await request(app)
      .post('/api/v1/webhooks/razorpay')
      .set('x-razorpay-signature', 'sig123')
      .send({
        event: 'payment_link.paid',
        payload: {
          payment_link: { entity: { id: 'plink_abc123' } },
          payment: { entity: { id: 'pay_1', method: 'card', amount: 10000 } },
        },
      });

    expect(recordOnlinePaymentMock).toHaveBeenCalledWith('order-1', 'credit_card', 100, 'pay_1', 'card');
  });

  it('falls back to credit_card (without crashing) for a method outside the 4-value set, e.g. wallet', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue({ id: 'inv-1', orderId: 'order-1' } as any);

    const res = await request(app)
      .post('/api/v1/webhooks/razorpay')
      .set('x-razorpay-signature', 'sig123')
      .send({
        event: 'payment_link.paid',
        payload: {
          payment_link: { entity: { id: 'plink_abc123' } },
          payment: { entity: { id: 'pay_1', method: 'wallet', amount: 10000 } },
        },
      });

    expect(res.status).toBe(200);
    expect(recordOnlinePaymentMock).toHaveBeenCalledWith('order-1', 'credit_card', 100, 'pay_1', 'wallet');
  });

  // Confirmed defect, fixed 2026-10-31: the active-link lookup alone used to
  // be the only resolution path — a late webhook for a link retired by an
  // admin waiver, a reissue, or a cash/bank_upi settlement found no invoice
  // and was silently dropped. This now falls back to PaymentLinkHistory
  // (which retains the original link->invoice mapping) before giving up.
  describe('historical-link fallback resolution', () => {
    it('resolves the invoice via PaymentLinkHistory when the active-link lookup misses (late payment on a retired link)', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(null);
      prismaMock.paymentLinkHistory.findFirst.mockResolvedValue({ invoiceId: 'inv-1' } as any);
      prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', orderId: 'order-1' } as any);

      const res = await request(app)
        .post('/api/v1/webhooks/razorpay')
        .set('x-razorpay-signature', 'sig123')
        .send(paymentLinkPaidPayload);

      expect(res.status).toBe(200);
      expect(prismaMock.paymentLinkHistory.findFirst).toHaveBeenCalledWith({
        where: { razorpayPaymentLinkId: 'plink_abc123', invoiceId: { not: null } },
        orderBy: { retiredAt: 'desc' },
      });
      expect(prismaMock.invoice.findUnique).toHaveBeenCalledWith({ where: { id: 'inv-1' } });
      expect(recordOnlinePaymentMock).toHaveBeenCalledWith('order-1', 'upi', 499, 'pay_xyz789', 'upi');
      expect(prismaMock.unmatchedProviderPayment.create).not.toHaveBeenCalled();
    });

    // Dedicated coverage per retirement cause (2026-10-31 follow-up) — the
    // resolution query itself filters only on razorpayPaymentLinkId and
    // invoiceId being set; it must not care WHY the link was retired.
    // Confirms this holds for all three real retiredReason values a late
    // payment can plausibly land after: an invoice reissue
    // (invoiceService.ts's generateInvoice), and a full/partial cash
    // settlement (orderService.ts::recordPayment, via retireOrReplaceLink).
    it.each(['reissue', 'cash_full', 'cash_partial'])(
      'resolves correctly via PaymentLinkHistory regardless of retiredReason (%s)',
      async (retiredReason) => {
        prismaMock.invoice.findFirst.mockResolvedValue(null);
        prismaMock.paymentLinkHistory.findFirst.mockResolvedValue({ invoiceId: 'inv-1', retiredReason } as any);
        prismaMock.invoice.findUnique.mockResolvedValue({ id: 'inv-1', orderId: 'order-1' } as any);

        const res = await request(app)
          .post('/api/v1/webhooks/razorpay')
          .set('x-razorpay-signature', 'sig123')
          .send(paymentLinkPaidPayload);

        expect(res.status).toBe(200);
        expect(recordOnlinePaymentMock).toHaveBeenCalledWith('order-1', 'upi', 499, 'pay_xyz789', 'upi');
        expect(prismaMock.unmatchedProviderPayment.create).not.toHaveBeenCalled();
      }
    );

    it('persists to the unmatched-payments queue, without calling recordOnlinePayment, when neither the active link nor history resolves an invoice', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(null);
      prismaMock.paymentLinkHistory.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/webhooks/razorpay')
        .set('x-razorpay-signature', 'sig123')
        .send(paymentLinkPaidPayload);

      expect(res.status).toBe(200);
      expect(recordOnlinePaymentMock).not.toHaveBeenCalled();
      expect(prismaMock.unmatchedProviderPayment.create).toHaveBeenCalledWith({
        data: {
          razorpayPaymentId: 'pay_xyz789',
          razorpayPaymentLinkId: 'plink_abc123',
          amountPaise: 49900n,
          rawPayload: paymentLinkPaidPayload,
        },
      });
    });

    it('does not duplicate the unmatched-payment row when the same unresolved payment is redelivered', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(null);
      prismaMock.paymentLinkHistory.findFirst.mockResolvedValue(null);
      prismaMock.unmatchedProviderPayment.create.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.0.0' })
      );

      const res = await request(app)
        .post('/api/v1/webhooks/razorpay')
        .set('x-razorpay-signature', 'sig123')
        .send(paymentLinkPaidPayload);

      expect(res.status).toBe(200);
    });

    // "Do not acknowledge a webhook as successfully processed if a
    // recoverable database failure prevented durable recording — allow safe
    // retries." A genuine (non-duplicate) failure while persisting the
    // unmatched payment must NOT ack 200.
    it('does not return 200 when persisting an unresolvable payment fails for a reason other than a duplicate', async () => {
      prismaMock.invoice.findFirst.mockResolvedValue(null);
      prismaMock.paymentLinkHistory.findFirst.mockResolvedValue(null);
      prismaMock.unmatchedProviderPayment.create.mockRejectedValue(new Error('connection reset'));

      const res = await request(app)
        .post('/api/v1/webhooks/razorpay')
        .set('x-razorpay-signature', 'sig123')
        .send(paymentLinkPaidPayload);

      expect(res.status).toBe(500);
    });
  });

  // Required: "extract and validate the actual Razorpay Payment ID and
  // captured/settled status" — payment_link.paid should normally only fire
  // once the payment is captured, but this is not trusted blindly.
  it('ignores the event (no invoice lookup, no recording) when payment.status is present and not "captured"', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/razorpay')
      .set('x-razorpay-signature', 'sig123')
      .send({
        event: 'payment_link.paid',
        payload: {
          payment_link: { entity: { id: 'plink_abc123' } },
          payment: { entity: { id: 'pay_xyz789', method: 'upi', amount: 49900, status: 'authorized' } },
        },
      });

    expect(res.status).toBe(200);
    expect(prismaMock.invoice.findFirst).not.toHaveBeenCalled();
    expect(recordOnlinePaymentMock).not.toHaveBeenCalled();
  });

  it('still proceeds normally when payment.status is "captured"', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue({ id: 'inv-1', orderId: 'order-1' } as any);

    const res = await request(app)
      .post('/api/v1/webhooks/razorpay')
      .set('x-razorpay-signature', 'sig123')
      .send({
        event: 'payment_link.paid',
        payload: {
          payment_link: { entity: { id: 'plink_abc123' } },
          payment: { entity: { id: 'pay_xyz789', method: 'upi', amount: 49900, status: 'captured' } },
        },
      });

    expect(res.status).toBe(200);
    expect(recordOnlinePaymentMock).toHaveBeenCalledWith('order-1', 'upi', 499, 'pay_xyz789', 'upi');
  });

  it('still returns 200 when recordOnlinePayment reports a monthly_billing_anomaly (logged, not thrown)', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue({ id: 'inv-1', orderId: 'order-1' } as any);
    recordOnlinePaymentMock.mockResolvedValue({ status: 'monthly_billing_anomaly' });

    const res = await request(app)
      .post('/api/v1/webhooks/razorpay')
      .set('x-razorpay-signature', 'sig123')
      .send(paymentLinkPaidPayload);

    expect(res.status).toBe(200);
  });

  // Payment-safety review section 8 — these two are now distinguished by
  // recordOnlinePayment, not conflated the way the old order.paymentStatus
  // check used to. The webhook controller just needs to ack 200 for both
  // and log appropriately; the actual safety behavior is in orderService's
  // own test suite.
  it('still returns 200 when recordOnlinePayment reports a duplicate_webhook (benign redelivery)', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue({ id: 'inv-1', orderId: 'order-1' } as any);
    recordOnlinePaymentMock.mockResolvedValue({ status: 'duplicate_webhook' });

    const res = await request(app)
      .post('/api/v1/webhooks/razorpay')
      .set('x-razorpay-signature', 'sig123')
      .send(paymentLinkPaidPayload);

    expect(res.status).toBe(200);
  });

  it('still returns 200 when recordOnlinePayment reports overpayment_recorded (a genuine second payment, not a duplicate)', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue({ id: 'inv-1', orderId: 'order-1' } as any);
    recordOnlinePaymentMock.mockResolvedValue({ status: 'overpayment_recorded' });

    const res = await request(app)
      .post('/api/v1/webhooks/razorpay')
      .set('x-razorpay-signature', 'sig123')
      .send(paymentLinkPaidPayload);

    expect(res.status).toBe(200);
  });
});

describe('POST /razorpay — payment.failed', () => {
  it('does not touch the database, just acknowledges', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/razorpay')
      .set('x-razorpay-signature', 'sig123')
      .send({
        event: 'payment.failed',
        payload: {
          payment: { entity: { id: 'pay_failed', error_code: 'BAD_REQUEST_ERROR', error_description: 'card declined' } },
        },
      });

    expect(res.status).toBe(200);
    expect(prismaMock.invoice.findFirst).not.toHaveBeenCalled();
    expect(recordOnlinePaymentMock).not.toHaveBeenCalled();
  });
});

describe('POST /razorpay — unhandled event types', () => {
  it('acknowledges with 200 rather than erroring, so Razorpay does not retry forever', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/razorpay')
      .set('x-razorpay-signature', 'sig123')
      .send({ event: 'payment_link.expired', payload: {} });

    expect(res.status).toBe(200);
  });
});
