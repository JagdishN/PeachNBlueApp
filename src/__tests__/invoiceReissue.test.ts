import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock('../services/invoiceService', () => ({
  generateInvoice: jest.fn(),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));

import prisma from '../prisma/client';
import { generateInvoice } from '../services/invoiceService';
import { sendNotification } from '../services/notificationService';
import { reissueInvoice, reissueAllOpenInvoicesForCustomer } from '../services/invoiceReissue.service';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const generateInvoiceMock = generateInvoice as jest.Mock;
const sendNotificationMock = sendNotification as jest.Mock;

beforeEach(() => {
  mockReset(prismaMock);
  generateInvoiceMock.mockReset();
  sendNotificationMock.mockReset();
  sendNotificationMock.mockResolvedValue(undefined);
});

describe('reissueInvoice', () => {
  const ORDER = {
    orderNumber: 'PB-ABCD1234',
    customer: { id: 'customer-1', phoneNumber: '9999999999', whatsappNumber: null },
  };

  it('delegates the actual PDF/payment-link work to invoiceService.generateInvoice (the one shared implementation)', async () => {
    prismaMock.order.findUnique.mockResolvedValue(ORDER as any);
    generateInvoiceMock.mockResolvedValue({
      amount: 900,
      paymentLinkUrl: 'https://rzp.io/l/new',
      pdfUrl: 'https://storage.example/new.pdf',
      wasReissue: true,
    });

    await reissueInvoice('order-1');

    expect(generateInvoiceMock).toHaveBeenCalledWith('order-1');
  });

  it('sends an invoice_reissued notification with the new amount, link, and PDF as WhatsApp media', async () => {
    prismaMock.order.findUnique.mockResolvedValue(ORDER as any);
    generateInvoiceMock.mockResolvedValue({
      amount: 900,
      paymentLinkUrl: 'https://rzp.io/l/new',
      pdfUrl: 'https://storage.example/new.pdf',
      wasReissue: true,
    });

    await reissueInvoice('order-1');

    expect(sendNotificationMock).toHaveBeenCalledWith(
      ORDER.customer,
      'invoice_reissued',
      expect.stringContaining('900'),
      'order-1',
      'https://storage.example/new.pdf'
    );
    expect(sendNotificationMock.mock.calls[0][2]).toContain('https://rzp.io/l/new');
  });

  it('throws when the order does not exist, without calling generateInvoice', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);

    await expect(reissueInvoice('missing-order')).rejects.toThrow('not found');
    expect(generateInvoiceMock).not.toHaveBeenCalled();
  });
});

describe('reissueAllOpenInvoicesForCustomer', () => {
  it('reissues every order that is not delivered and not paid, and skips delivered/paid ones via the query filter', async () => {
    prismaMock.order.findMany.mockResolvedValue([{ id: 'order-1' }, { id: 'order-2' }] as any);
    prismaMock.order.findUnique.mockResolvedValue({
      orderNumber: 'PB-XXXX',
      customer: { id: 'customer-1', phoneNumber: '9999999999', whatsappNumber: null },
    } as any);
    generateInvoiceMock.mockResolvedValue({
      amount: 500,
      paymentLinkUrl: 'https://rzp.io/l/x',
      pdfUrl: null,
      wasReissue: true,
    });

    await reissueAllOpenInvoicesForCustomer('customer-1');

    const findManyArgs = prismaMock.order.findMany.mock.calls[0][0] as any;
    expect(findManyArgs.where).toEqual({
      customerId: 'customer-1',
      internalStatus: { not: 'delivered' },
      paymentStatus: { not: 'paid' },
    });
    expect(generateInvoiceMock).toHaveBeenCalledTimes(2);
    expect(generateInvoiceMock).toHaveBeenNthCalledWith(1, 'order-1');
    expect(generateInvoiceMock).toHaveBeenNthCalledWith(2, 'order-2');
  });

  it('does nothing when the customer has no open orders', async () => {
    prismaMock.order.findMany.mockResolvedValue([]);

    await reissueAllOpenInvoicesForCustomer('customer-1');

    expect(generateInvoiceMock).not.toHaveBeenCalled();
  });
});
