const createMock = jest.fn();
const cancelMock = jest.fn();

jest.mock('razorpay', () => {
  return jest.fn().mockImplementation(() => ({
    paymentLink: { create: createMock, cancel: cancelMock },
  }));
});

import { createPaymentLink, cancelPaymentLink } from '../lib/razorpayClient';

beforeEach(() => {
  createMock.mockReset();
  cancelMock.mockReset();
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
