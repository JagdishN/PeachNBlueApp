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
import { MSG91_TEMPLATES } from '../constants/msg91Templates';

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
    customer: { id: 'customer-1', fullName: 'Test Customer', phoneNumber: '9999999999', whatsappNumber: null },
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

  // Real Meta-approved invoice_reissued template (CLAUDE.md "Approved
  // WhatsApp Templates", 2026-09-02): name/order#/amount as body variables.
  // CORRECTED (2026-09-03): the template turned out to have no URL button
  // component (confirmed directly with the client against a real pulled
  // definition) — the link is now appended as plain text onto the amount
  // variable instead of sent via a nonexistent button.
  it('sends an invoice_reissued notification with the customer name, order#, and the link appended as text onto the amount variable', async () => {
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
      {
        name: MSG91_TEMPLATES.invoiceReissued.name,
        language: MSG91_TEMPLATES.invoiceReissued.language,
        bodyVariables: ['Test Customer', 'PB-ABCD1234', '900. Pay online: https://rzp.io/l/new'],
      },
      'order-1'
    );
  });

  it('throws when the order does not exist, without calling generateInvoice', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);

    await expect(reissueInvoice('missing-order')).rejects.toThrow('not found');
    expect(generateInvoiceMock).not.toHaveBeenCalled();
  });

  // invoiceService.ts no longer creates a real Razorpay link for
  // monthly-billing orders — paymentLinkUrl comes back null. The approved
  // invoice_reissued template has no body-variable slot for "settled via
  // your monthly statement", so this notification is skipped entirely in
  // that case rather than sent with nothing to append.
  it('skips the notification entirely (no link to append) when paymentLinkUrl is null', async () => {
    prismaMock.order.findUnique.mockResolvedValue(ORDER as any);
    generateInvoiceMock.mockResolvedValue({
      amount: 900,
      paymentLinkUrl: null,
      pdfUrl: 'https://storage.example/new.pdf',
      wasReissue: true,
    });

    await reissueInvoice('order-1');

    expect(sendNotificationMock).not.toHaveBeenCalled();
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
