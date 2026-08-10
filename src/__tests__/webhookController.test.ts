import 'express-async-errors';
import express from 'express';
import request from 'supertest';
import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

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

  it('does not call recordOnlinePayment when no matching invoice is found', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/webhooks/razorpay')
      .set('x-razorpay-signature', 'sig123')
      .send(paymentLinkPaidPayload);

    expect(res.status).toBe(200);
    expect(recordOnlinePaymentMock).not.toHaveBeenCalled();
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
