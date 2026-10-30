import express from 'express';
import request from 'supertest';
import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from '../prisma/client';
import payRoutes from '../routes/pay';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const app = express();
app.use('/pay', payRoutes);

beforeEach(() => {
  mockReset(prismaMock);
  prismaMock.paymentLinkTransition.findFirst.mockResolvedValue(null);
  prismaMock.payment.findFirst.mockResolvedValue(null);
});

describe('GET /pay/:token', () => {
  it('returns 404 (a friendly status page, not raw JSON) for an unknown token', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/pay/not-a-real-token');

    expect(res.status).toBe(404);
    expect(res.text).toContain('invalid or has expired');
  });

  it('redirects to the live Razorpay link when the invoice is still payable and nothing is in-flight', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      paymentToken: 'tok-1',
      invoicePaymentStatus: 'unpaid',
      razorpayPaymentLinkId: 'plink_1',
      paymentLinkUrl: 'https://rzp.io/l/plink_1',
    } as any);

    const res = await request(app).get('/pay/tok-1');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://rzp.io/l/plink_1');
  });

  it('shows "already paid" without redirecting when the invoice is fully settled', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      paymentToken: 'tok-1',
      invoicePaymentStatus: 'paid',
      razorpayPaymentLinkId: null,
      paymentLinkUrl: null,
    } as any);

    const res = await request(app).get('/pay/tok-1');

    expect(res.status).toBe(200);
    expect(res.text).toContain('already been paid');
  });

  // Spec section 5: "Check whether payment-link reconciliation is in
  // progress" — must not redirect into a link that might be mid-replacement.
  it('shows a "one moment" hold page when a payment-link transition is still in flight', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      paymentToken: 'tok-1',
      invoicePaymentStatus: 'partially_paid',
      razorpayPaymentLinkId: 'plink_old',
      paymentLinkUrl: 'https://rzp.io/l/plink_old',
    } as any);
    prismaMock.paymentLinkTransition.findFirst.mockResolvedValue({ id: 'transition-1', status: 'cancelling_old_link' } as any);

    const res = await request(app).get('/pay/tok-1');

    expect(res.status).toBe(200);
    expect(res.text).toContain('being updated');
    // Must not have redirected to the possibly-stale link.
    expect(res.headers.location).toBeUndefined();
  });

  // Spec section 5: "Check whether manual UPI verification requires a
  // temporary hold."
  it('shows a "payment under review" hold page when a bank_upi report is still pending verification', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      paymentToken: 'tok-1',
      invoicePaymentStatus: 'unpaid',
      razorpayPaymentLinkId: 'plink_1',
      paymentLinkUrl: 'https://rzp.io/l/plink_1',
    } as any);
    prismaMock.payment.findFirst.mockResolvedValue({ id: 'payment-1', verificationStatus: 'pending' } as any);

    const res = await request(app).get('/pay/tok-1');

    expect(res.status).toBe(200);
    expect(res.text).toContain('under review');
    expect(res.headers.location).toBeUndefined();
  });

  it('shows a generic "temporarily unavailable" page when there is no live link and the invoice is not paid', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      paymentToken: 'tok-1',
      invoicePaymentStatus: 'unpaid',
      razorpayPaymentLinkId: null,
      paymentLinkUrl: null,
    } as any);

    const res = await request(app).get('/pay/tok-1');

    expect(res.status).toBe(200);
    expect(res.text).toContain('temporarily unavailable');
  });
});
