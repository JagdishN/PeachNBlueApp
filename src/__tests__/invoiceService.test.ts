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
import { renderInvoicePdf } from '../services/invoicePdfService';
import { generateInvoice } from '../services/invoiceService';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const createPaymentLinkMock = createPaymentLink as jest.Mock;
const cancelPaymentLinkMock = cancelPaymentLink as jest.Mock;
const uploadInvoicePdfMock = uploadInvoicePdf as jest.Mock;
const renderInvoicePdfMock = renderInvoicePdf as jest.Mock;

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
    discountEnabled: false,
    locationLabel: 'A-101',
    branch: { branchName: 'Attapur' },
  },
  orderItems: [
    {
      itemName: "Men's Shirt",
      quantity: 2,
      unitPrice: 129,
      weightKg: null,
      pricePerKg: null,
      lineTotal: 258,
      garment: { serviceType: 'dry_clean' },
    },
  ],
  invoice: null as any,
};

beforeEach(() => {
  mockReset(prismaMock);
  prismaMock.invoiceAdjustment.findMany.mockResolvedValue([]);
  createPaymentLinkMock.mockReset();
  cancelPaymentLinkMock.mockReset();
  uploadInvoicePdfMock.mockReset();
  renderInvoicePdfMock.mockReset();

  createPaymentLinkMock.mockResolvedValue({ id: 'plink_1', shortUrl: 'https://rzp.io/l/plink_1' });
  uploadInvoicePdfMock.mockResolvedValue('https://storage.example/invoices/PB-INV-TEST.pdf');
  renderInvoicePdfMock.mockResolvedValue(Buffer.from('pdf-bytes'));
  prismaMock.invoice.upsert.mockImplementation(((args: any) =>
    Promise.resolve({ id: 'invoice-1', ...args.create, ...args.update })) as any);
  // Default: no bag-replacement charges tied to this order (CLAUDE.md
  // "Bag-replacement ₹350 charge" wiring) — overridden per-test below.
  prismaMock.additionalCharge.findMany.mockResolvedValue([]);
  // Default: nothing already paid against a prior invoice (payment-safety
  // review section 10's "don't recreate a link for an already-paid
  // balance" fix) — overridden per-test below.
  prismaMock.payment.aggregate.mockResolvedValue({ _sum: { allocatedPaise: 0n } } as any);
  // payTokenService.ts::ensurePaymentToken short-circuits when a token
  // already exists — not under test here, just needs to not throw.
  prismaMock.invoice.findUnique.mockResolvedValue({ id: 'invoice-1', paymentToken: 'existing-token' } as any);
  // Outstanding-dues rework: default to "no other outstanding invoices"
  // for the previous-dues snapshot lookup (getCustomerOutstandingSummary)
  // — overridden per-test below where previous dues are actually tested.
  prismaMock.invoice.findMany.mockResolvedValue([]);
});

describe('generateInvoice — fresh invoice (no prior Invoice row)', () => {
  it('computes the full amount when the customer has no discount', async () => {
    prismaMock.order.findUnique.mockResolvedValue(BASE_ORDER as any);

    const result = await generateInvoice('order-1');

    expect(result.amount).toBe(1000);
    expect(result.wasReissue).toBe(false);
    expect(createPaymentLinkMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 1000 }));
  });

  it('applies the customer discount percent to the payable amount when discountEnabled is true', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      ...BASE_ORDER,
      customer: { ...BASE_ORDER.customer, discountPercent: 10, discountEnabled: true },
    } as any);

    const result = await generateInvoice('order-1');

    expect(result.amount).toBe(900);
    expect(createPaymentLinkMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 900 }));
  });

  // CLAUDE.md "Monthly billing + discount: now live" — discountEnabled: false
  // must NOT clear discountPercent, but it must also stop it from applying.
  it('does not apply discountPercent when discountEnabled is false, even though a percent is stored', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      ...BASE_ORDER,
      customer: { ...BASE_ORDER.customer, discountPercent: 10, discountEnabled: false },
    } as any);

    const result = await generateInvoice('order-1');

    expect(result.amount).toBe(1000);
    expect(createPaymentLinkMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 1000 }));
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

  // Outstanding-dues rework, client decision (2026-10-30): due date =
  // invoice date + 4 days, set once.
  it('sets dueDate to 4 days from now on a fresh invoice', async () => {
    prismaMock.order.findUnique.mockResolvedValue(BASE_ORDER as any);
    const before = new Date();

    await generateInvoice('order-1');

    const upsertArgs = prismaMock.invoice.upsert.mock.calls[0][0] as any;
    const expected = new Date(before);
    expected.setDate(expected.getDate() + 4);
    expect(Math.abs(upsertArgs.create.dueDate.getTime() - expected.getTime())).toBeLessThan(5000);
  });
});

// Outstanding-dues rework, section 3 — "Current Order Charges: ₹150,
// Previous Outstanding: ₹150, Total Amount Payable: ₹300" and "the new
// invoice's sales value must remain ₹150."
describe('generateInvoice — previous dues snapshot (fresh invoice only)', () => {
  it('reports previousDuesTotal from other outstanding invoices, without changing this invoice\'s own amount', async () => {
    prismaMock.order.findUnique.mockResolvedValue(BASE_ORDER as any);
    prismaMock.invoice.findMany.mockResolvedValue([
      { id: 'inv-old-1', orderId: 'order-old-1', amount: 100, dueDate: new Date('2026-07-05'), createdAt: new Date('2026-07-01'), order: { orderNumber: 'PB-OLD1' } },
    ] as any);
    // That old invoice's own getInvoicePaymentSummary lookup: ₹50 paid of ₹100 -> ₹50 outstanding.
    prismaMock.invoice.findUnique
      .mockResolvedValueOnce({ id: 'inv-old-1', amount: 100 } as any) // inside getCustomerOutstandingSummary's loop
      .mockResolvedValue({ id: 'invoice-1', paymentToken: 'existing-token' } as any); // ensurePaymentToken, later
    prismaMock.payment.findMany.mockResolvedValue([
      { paymentSource: 'cash', amountPaise: 5000n, allocatedPaise: 5000n },
    ] as any);

    const result = await generateInvoice('order-1');

    expect(result.amount).toBe(1000); // this order's own sale value, unchanged
    expect(result.previousDuesTotal).toBe(50);
    expect(prismaMock.invoicePreviousDuesLine.createMany).toHaveBeenCalledWith({
      data: [{ invoiceId: 'invoice-1', priorInvoiceId: 'inv-old-1', outstandingAtSnapshotPaise: 5000n }],
    });
  });

  it('passes previousDuesTotal through to the PDF renderer', async () => {
    prismaMock.order.findUnique.mockResolvedValue(BASE_ORDER as any);
    prismaMock.invoice.findMany.mockResolvedValue([
      { id: 'inv-old-1', orderId: 'order-old-1', amount: 100, dueDate: new Date('2026-07-05'), createdAt: new Date('2026-07-01'), order: { orderNumber: 'PB-OLD1' } },
    ] as any);
    prismaMock.invoice.findUnique
      .mockResolvedValueOnce({ id: 'inv-old-1', amount: 100 } as any)
      .mockResolvedValue({ id: 'invoice-1', paymentToken: 'existing-token' } as any);
    prismaMock.payment.findMany.mockResolvedValue([]); // nothing paid -> full ₹100 outstanding

    await generateInvoice('order-1');

    expect(renderInvoicePdfMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 1000, previousDuesTotal: 100 }));
  });

  it('does not re-snapshot (or query for) previous dues on a reissue of the same order', async () => {
    const PREVIOUS_INVOICE = { id: 'invoice-1', invoiceNumber: 'PB-INV-AAAA1111', razorpayPaymentLinkId: 'plink_old', version: 1 };
    prismaMock.order.findUnique.mockResolvedValue({ ...BASE_ORDER, invoice: PREVIOUS_INVOICE } as any);

    const result = await generateInvoice('order-1');

    expect(result.previousDuesTotal).toBe(0);
    expect(prismaMock.invoice.findMany).not.toHaveBeenCalled(); // getCustomerOutstandingSummary never called
    expect(prismaMock.invoicePreviousDuesLine.createMany).not.toHaveBeenCalled();
  });

  it('skips invoices with zero outstanding when building the snapshot', async () => {
    prismaMock.order.findUnique.mockResolvedValue(BASE_ORDER as any);
    prismaMock.invoice.findMany.mockResolvedValue([
      { id: 'inv-paid', orderId: 'order-paid', amount: 100, dueDate: new Date(), createdAt: new Date(), order: { orderNumber: 'PB-PAID' } },
    ] as any);
    prismaMock.invoice.findUnique
      .mockResolvedValueOnce({ id: 'inv-paid', amount: 100 } as any)
      .mockResolvedValue({ id: 'invoice-1', paymentToken: 'existing-token' } as any);
    prismaMock.payment.findMany.mockResolvedValue([{ paymentSource: 'cash', amountPaise: 10000n, allocatedPaise: 10000n }] as any); // fully paid

    const result = await generateInvoice('order-1');

    expect(result.previousDuesTotal).toBe(0);
    expect(prismaMock.invoicePreviousDuesLine.createMany).not.toHaveBeenCalled();
  });
});

// CLAUDE.md "Bag-replacement ₹350 charge" — wired to the invoice as a flat,
// non-discounted add-on, only for charges tied to THIS order via orderId.
describe('generateInvoice — bag-replacement charges tied to this order', () => {
  it('adds a single bag_replacement charge on top of the (undiscounted) subtotal', async () => {
    prismaMock.order.findUnique.mockResolvedValue(BASE_ORDER as any);
    prismaMock.additionalCharge.findMany.mockResolvedValue([{ amount: 350 }] as any);

    const result = await generateInvoice('order-1');

    expect(result.amount).toBe(1350);
    expect(createPaymentLinkMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 1350 }));
    expect(prismaMock.additionalCharge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: 'order-1', chargeType: 'bag_replacement' } })
    );
  });

  it('sums multiple bag_replacement charges tied to the same order', async () => {
    prismaMock.order.findUnique.mockResolvedValue(BASE_ORDER as any);
    prismaMock.additionalCharge.findMany.mockResolvedValue([{ amount: 350 }, { amount: 350 }] as any);

    const result = await generateInvoice('order-1');

    expect(result.amount).toBe(1700);
  });

  it('adds the flat charge AFTER discount, not before (charge itself is never discounted)', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      ...BASE_ORDER,
      customer: { ...BASE_ORDER.customer, discountPercent: 10, discountEnabled: true },
    } as any);
    prismaMock.additionalCharge.findMany.mockResolvedValue([{ amount: 350 }] as any);

    const result = await generateInvoice('order-1');

    // 1000 subtotal -> 900 after 10% discount, then +350 flat = 1250, NOT
    // (1000 + 350) * 0.9 = 1215.
    expect(result.amount).toBe(1250);
  });

  it('does not add anything when there are no bag-replacement charges tied to this order', async () => {
    prismaMock.order.findUnique.mockResolvedValue(BASE_ORDER as any);
    prismaMock.additionalCharge.findMany.mockResolvedValue([]);

    const result = await generateInvoice('order-1');

    expect(result.amount).toBe(1000);
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

  // Payment-safety review section 10: "An invoice revision must not...
  // accidentally create an active link for an incorrect balance." The
  // PDF's displayed amount stays the full total; only the link's requested
  // amount should net out what's already been verified+allocated.
  it('nets out already-allocated payments from the NEW link amount, but not from the displayed invoice amount', async () => {
    prismaMock.order.findUnique.mockResolvedValue({ ...BASE_ORDER, invoice: PREVIOUS_INVOICE } as any);
    prismaMock.payment.aggregate.mockResolvedValue({ _sum: { allocatedPaise: 40000n } } as any); // ₹400 already paid

    const result = await generateInvoice('order-1');

    expect(result.amount).toBe(1000); // full invoice total, unchanged
    expect(createPaymentLinkMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 600 })); // 1000 - 400
  });

  // Outstanding-dues rework: a reissue (discount change, amount revision)
  // must NOT push the due date forward — it stays whatever the order's
  // FIRST invoice set it to.
  it('preserves the due date from the prior invoice version on reissue, rather than recalculating it', async () => {
    const existingDueDate = new Date('2026-07-01');
    prismaMock.order.findUnique.mockResolvedValue({
      ...BASE_ORDER,
      invoice: { ...PREVIOUS_INVOICE, dueDate: existingDueDate },
    } as any);

    await generateInvoice('order-1');

    const upsertArgs = prismaMock.invoice.upsert.mock.calls[0][0] as any;
    expect(upsertArgs.update.dueDate).toEqual(existingDueDate);
  });

  it('creates no new link at all when prior payments already cover the full (possibly revised) amount', async () => {
    prismaMock.order.findUnique.mockResolvedValue({ ...BASE_ORDER, invoice: PREVIOUS_INVOICE } as any);
    prismaMock.payment.aggregate.mockResolvedValue({ _sum: { allocatedPaise: 100000n } } as any); // ₹1000 already paid

    const result = await generateInvoice('order-1');

    expect(createPaymentLinkMock).not.toHaveBeenCalled();
    expect(result.paymentLinkUrl).toBeNull();
    const upsertArgs = prismaMock.invoice.upsert.mock.calls[0][0] as any;
    expect(upsertArgs.update.paymentLinkStatus).toBe('paid');
  });
});

// CLAUDE.md "Razorpay webhook — implemented" / the AskUserQuestion decision:
// monthly-billing customers settle via the ledger, not a real payable link —
// generating one anyway (the pre-existing behavior) contradicted that even
// before the webhook made it consequential. Fixed at the source here rather
// than taught to the webhook.
describe('generateInvoice — monthly-billing orders never get a real payment link', () => {
  const MONTHLY_ORDER = { ...BASE_ORDER, billingMode: 'monthly_billing' };

  it('does not call createPaymentLink', async () => {
    prismaMock.order.findUnique.mockResolvedValue(MONTHLY_ORDER as any);

    await generateInvoice('order-1');

    expect(createPaymentLinkMock).not.toHaveBeenCalled();
  });

  it('persists null razorpayPaymentLinkId/paymentLinkUrl and a null paymentLinkStatus', async () => {
    prismaMock.order.findUnique.mockResolvedValue(MONTHLY_ORDER as any);

    const result = await generateInvoice('order-1');

    expect(result.paymentLinkUrl).toBeNull();
    const upsertArgs = prismaMock.invoice.upsert.mock.calls[0][0] as any;
    expect(upsertArgs.create).toMatchObject({
      razorpayPaymentLinkId: null,
      paymentLinkUrl: null,
      paymentLinkStatus: null,
    });
  });

  it('still cancels a legacy real link from before this fix existed (defensive cleanup, harmless no-op otherwise)', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      ...MONTHLY_ORDER,
      invoice: { id: 'invoice-1', invoiceNumber: 'PB-INV-AAAA1111', razorpayPaymentLinkId: 'plink_legacy', version: 1 },
    } as any);

    await generateInvoice('order-1');

    expect(cancelPaymentLinkMock).toHaveBeenCalledWith('plink_legacy');
    expect(createPaymentLinkMock).not.toHaveBeenCalled();
  });

  it('still generates and uploads the PDF (invoice, just no live link)', async () => {
    prismaMock.order.findUnique.mockResolvedValue(MONTHLY_ORDER as any);

    const result = await generateInvoice('order-1');

    expect(uploadInvoicePdfMock).toHaveBeenCalled();
    expect(result.pdfUrl).not.toBeNull();
  });
});

describe('generateInvoice — order not found', () => {
  it('throws when the order does not exist', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);

    await expect(generateInvoice('missing-order')).rejects.toThrow('not found');
  });
});
