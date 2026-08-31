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
  it('converts the amount to paise and returns id + shortUrl', async () => {
    createMock.mockResolvedValue({ id: 'plink_123', short_url: 'https://rzp.io/l/plink_123' });

    const result = await createPaymentLink({
      amount: 249.5,
      orderNumber: 'PB-ABCD1234',
      orderId: 'order-1',
      customerName: 'Test Customer',
      customerPhone: '9999999999',
    });

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 24950, currency: 'INR' }));
    expect(result).toEqual({ id: 'plink_123', shortUrl: 'https://rzp.io/l/plink_123' });
  });
});

describe('cancelPaymentLink (best-effort)', () => {
  it('does not throw when the Razorpay API call rejects', async () => {
    cancelMock.mockRejectedValue(new Error('razorpay unavailable'));

    await expect(cancelPaymentLink('plink_old')).resolves.toBeUndefined();
    expect(cancelMock).toHaveBeenCalledWith('plink_old');
  });

  it('calls cancel with the given id on success', async () => {
    cancelMock.mockResolvedValue({});

    await cancelPaymentLink('plink_old');

    expect(cancelMock).toHaveBeenCalledWith('plink_old');
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
