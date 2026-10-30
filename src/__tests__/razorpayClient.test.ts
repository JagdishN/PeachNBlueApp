const createMock = jest.fn();
const cancelMock = jest.fn();
const validateWebhookSignatureMock = jest.fn();

jest.mock('razorpay', () => {
  // validateWebhookSignature is a STATIC method on the real Razorpay class
  // (Razorpay.validateWebhookSignature(...), not an instance method) — has
  // to be attached to the mock constructor function itself, not returned
  // from mockImplementation, or verifyWebhookSignature below would call
  // undefined.
  const MockRazorpay: any = jest.fn().mockImplementation(() => ({
    paymentLink: { create: createMock, cancel: cancelMock },
  }));
  MockRazorpay.validateWebhookSignature = validateWebhookSignatureMock;
  return MockRazorpay;
});

import { createPaymentLink, cancelPaymentLink, verifyWebhookSignature } from '../lib/razorpayClient';

beforeEach(() => {
  createMock.mockReset();
  cancelMock.mockReset();
  validateWebhookSignatureMock.mockReset();
});

describe('createPaymentLink', () => {
  it('converts the amount to paise, disables native partial payments, and returns id + shortUrl', async () => {
    createMock.mockResolvedValue({ id: 'plink_123', short_url: 'https://rzp.io/l/plink_123' });

    const result = await createPaymentLink({
      amount: 249.5,
      orderNumber: 'PB-ABCD1234',
      orderId: 'order-1',
      customerName: 'Test Customer',
      customerPhone: '9999999999',
    });

    // Payment-safety review Priority 1: must explicitly disable native
    // partial payments, using Razorpay's real parameter name (accept_partial,
    // confirmed against their API reference), not an undocumented default.
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 24950, currency: 'INR', accept_partial: false })
    );
    expect(result).toEqual({ id: 'plink_123', shortUrl: 'https://rzp.io/l/plink_123' });
  });
});

describe('cancelPaymentLink', () => {
  it('does not throw when the Razorpay API call rejects, and reports the failure as uncertain', async () => {
    cancelMock.mockRejectedValue(new Error('razorpay unavailable'));

    const result = await cancelPaymentLink('plink_old');

    expect(result).toEqual({ success: false, uncertain: true, error: 'razorpay unavailable' });
    expect(cancelMock).toHaveBeenCalledWith('plink_old');
  });

  it('reports success when Razorpay confirms the cancelled status', async () => {
    cancelMock.mockResolvedValue({ status: 'cancelled' });

    const result = await cancelPaymentLink('plink_old');

    expect(result).toEqual({ success: true, uncertain: false });
  });

  // Payment-safety review 4.3: "do not assume cancelling a link reverses an
  // already initiated payment" / "handle... uncertain provider responses" —
  // an unexpected (non-"cancelled") status must NOT be treated as success.
  it('reports uncertain when Razorpay returns an unexpected status instead of "cancelled"', async () => {
    cancelMock.mockResolvedValue({ status: 'paid' });

    const result = await cancelPaymentLink('plink_old');

    expect(result.success).toBe(false);
    expect(result.uncertain).toBe(true);
  });
});

describe('verifyWebhookSignature', () => {
  it('delegates to Razorpay.validateWebhookSignature with the raw body, signature, and configured secret', () => {
    validateWebhookSignatureMock.mockReturnValue(true);

    const result = verifyWebhookSignature('{"event":"payment_link.paid"}', 'sig123');

    expect(result).toBe(true);
    expect(validateWebhookSignatureMock).toHaveBeenCalledWith('{"event":"payment_link.paid"}', 'sig123', expect.any(String));
  });

  it('returns false for an invalid signature rather than throwing', () => {
    validateWebhookSignatureMock.mockReturnValue(false);

    expect(verifyWebhookSignature('{}', 'bad-sig')).toBe(false);
  });
});
