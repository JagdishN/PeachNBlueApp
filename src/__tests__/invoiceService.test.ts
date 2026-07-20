import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock('../lib/razorpayClient', () => ({
  createPaymentLink: jest.fn(),
  cancelPaymentLink: jest.fn(),
}));
jest.mock('../lib/supabaseStorage', () => ({
  uploadInvoicePdf: jest.fn(),
}));
jest.mock('../services/invoicePdfService', () => ({
  renderInvoicePdf: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
}));

import prisma from '../prisma/client';
import { createPaymentLink, cancelPaymentLink } from '../lib/razorpayClient';
import { uploadInvoicePdf } from '../lib/supabaseStorage';
import { generateInvoice } from '../services/invoiceService';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const createPaymentLinkMock = createPaymentLink as jest.Mock;
const cancelPaymentLinkMock = cancelPaymentLink as jest.Mock;
const uploadInvoicePdfMock = uploadInvoicePdf as jest.Mock;

const BASE_ORDER = {
  id: 'order-1',
  orderNumber: 'PB-ABCD1234',
  finalAmount: 1000,
  pickupDate: new Date('2026-07-20'),
  customer: {
    id: 'customer-1',
    fullName: 'Test Customer',
    phoneNumber: '9999999999',
    discountPercent: null as number | null,
    locationLabel: 'A-101',
    branch: { branchName: 'Attapur' },
  },
  orderItems: [
    { itemName: "Men's Shirt", quantity: 2, unitPrice: 129, weightKg: null, pricePerKg: null, lineTotal: 258 },
  ],
  invoice: null as any,
};

beforeEach(() => {
  mockReset(prismaMock);
  createPaymentLinkMock.mockReset();
  cancelPaymentLinkMock.mockReset();
  uploadInvoicePdfMock.mockReset();

  createPaymentLinkMock.mockResolvedValue({ id: 'plink_1', shortUrl: 'https://rzp.io/l/plink_1' });
  uploadInvoicePdfMock.mockResolvedValue('https://storage.example/invoices/PB-INV-TEST.pdf');
  prismaMock.invoice.upsert.mockImplementation(((args: any) =>
    Promise.resolve({ id: 'invoice-1', ...args.create, ...args.update })) as any);
});

describe('generateInvoice — fresh invoice (no prior Invoice row)', () => {
  it('computes the full amount when the customer has no discount', async () => {
    prismaMock.order.findUnique.mockResolvedValue(BASE_ORDER as any);

    const result = await generateInvoice('order-1');

    expect(result.amount).toBe(1000);
    expect(result.wasReissue).toBe(false);
    expect(createPaymentLinkMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 1000 }));
  });

  it('applies the customer discount percent to the payable amount', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      ...BASE_ORDER,
      customer: { ...BASE_ORDER.customer, discountPercent: 10 },
    } as any);

    const result = await generateInvoice('order-1');

    expect(result.amount).toBe(900);
    expect(createPaymentLinkMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 900 }));
  });

  it('does not attempt to cancel any payment link when there is no prior invoice', async () => {
    prismaMock.order.findUnique.mockResolvedValue(BASE_ORDER as any);

    await generateInvoice('order-1');

    expect(cancelPaymentLinkMock).not.toHaveBeenCalled();
  });

  it('persists version 1 with no "-R" suffix on the invoice number', async () => {
    prismaMock.order.findUnique.mockResolvedValue(BASE_ORDER as any);

    await generateInvoice('order-1');

    const upsertArgs = prismaMock.invoice.upsert.mock.calls[0][0] as any;
    expect(upsertArgs.create.version).toBe(1);
    expect(upsertArgs.create.invoiceNumber).not.toMatch(/-R\d+$/);
  });
});

describe('generateInvoice — reissue (prior Invoice row exists)', () => {
  const PREVIOUS_INVOICE = {
    id: 'invoice-1',
    invoiceNumber: 'PB-INV-AAAA1111',
    razorpayPaymentLinkId: 'plink_old',
    version: 1,
  };

  it('cancels the previous payment link before persisting the new one', async () => {
    prismaMock.order.findUnique.mockResolvedValue({ ...BASE_ORDER, invoice: PREVIOUS_INVOICE } as any);

    await generateInvoice('order-1');

    expect(cancelPaymentLinkMock).toHaveBeenCalledWith('plink_old');
  });

  it('bumps the version and suffixes the invoice number with -R{version}', async () => {
    prismaMock.order.findUnique.mockResolvedValue({ ...BASE_ORDER, invoice: PREVIOUS_INVOICE } as any);

    await generateInvoice('order-1');

    const upsertArgs = prismaMock.invoice.upsert.mock.calls[0][0] as any;
    expect(upsertArgs.update.version).toBe(2);
    expect(upsertArgs.update.invoiceNumber).toBe('PB-INV-AAAA1111-R2');
  });

  it('reports wasReissue: true', async () => {
    prismaMock.order.findUnique.mockResolvedValue({ ...BASE_ORDER, invoice: PREVIOUS_INVOICE } as any);

    const result = await generateInvoice('order-1');

    expect(result.wasReissue).toBe(true);
  });

});

describe('generateInvoice — order not found', () => {
  it('throws when the order does not exist', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);

    await expect(generateInvoice('missing-order')).rejects.toThrow('not found');
  });
});
