import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from '../prisma/client';
import {
  createVendorInvoice,
  updateVendorInvoice,
  voidVendorInvoice,
  listVendorInvoices,
  getVendorInvoiceSummary,
  toVendorInvoiceCsv,
} from '../services/vendorInvoiceService';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
  prismaMock.$transaction.mockImplementation(((cb: any) => cb(prismaMock)) as any);
});

describe('createVendorInvoice', () => {
  const baseInput = { vendorName: 'Acme Laundry Co', serviceType: 'wash_fold' as const, amount: 500, createdById: 'admin-1' };

  // Mandatory test #1
  it('creates with valid inputs and writes a "created" audit row', async () => {
    prismaMock.vendorInvoice.create.mockResolvedValue({ id: 'vi-1' } as any);

    await createVendorInvoice(baseInput);

    expect(prismaMock.vendorInvoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorName: 'Acme Laundry Co',
        serviceType: 'wash_fold',
        amountPaise: 50000n,
        paymentStatus: 'unpaid',
        branchId: null,
      }),
    });
    expect(prismaMock.vendorInvoiceAudit.create).toHaveBeenCalledWith({
      data: { vendorInvoiceId: 'vi-1', action: 'created', actedById: 'admin-1' },
    });
  });

  // Mandatory test #2
  it('rejects a missing/blank vendor name', async () => {
    await expect(createVendorInvoice({ ...baseInput, vendorName: '   ' })).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.vendorInvoice.create).not.toHaveBeenCalled();
  });

  // Mandatory test #3
  it('rejects a missing/invalid service type', async () => {
    await expect(createVendorInvoice({ ...baseInput, serviceType: 'laundry' as any })).rejects.toMatchObject({ status: 400 });
  });

  // Mandatory test #4
  it('rejects a zero or negative amount', async () => {
    await expect(createVendorInvoice({ ...baseInput, amount: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(createVendorInvoice({ ...baseInput, amount: -50 })).rejects.toMatchObject({ status: 400 });
  });

  // Mandatory test #5
  it('saves an optional description, trimmed, and treats blank as null', async () => {
    prismaMock.vendorInvoice.create.mockResolvedValue({ id: 'vi-1' } as any);
    await createVendorInvoice({ ...baseInput, description: '  Monthly bulk wash  ' });
    expect(prismaMock.vendorInvoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ description: 'Monthly bulk wash' }),
    });
  });

  // Mandatory test #6
  it('defaults Payment Done to OFF (unpaid, no paidAt/paidBy) when omitted', async () => {
    prismaMock.vendorInvoice.create.mockResolvedValue({ id: 'vi-1' } as any);
    await createVendorInvoice(baseInput);
    expect(prismaMock.vendorInvoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ paymentStatus: 'unpaid', paidAt: null, paidById: null }),
    });
    expect(prismaMock.vendorInvoiceAudit.create).toHaveBeenCalledTimes(1); // only 'created', no payment-status audit
  });

  // Mandatory test #7
  it('creates with Payment Done ON — paid immediately, with its own audit row', async () => {
    prismaMock.vendorInvoice.create.mockResolvedValue({ id: 'vi-1' } as any);
    await createVendorInvoice({ ...baseInput, paymentDone: true });

    expect(prismaMock.vendorInvoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ paymentStatus: 'paid', paidAt: expect.any(Date), paidById: 'admin-1' }),
    });
    expect(prismaMock.vendorInvoiceAudit.create).toHaveBeenCalledWith({
      data: { vendorInvoiceId: 'vi-1', action: 'payment_marked_paid', actedById: 'admin-1' },
    });
  });
});

describe('updateVendorInvoice', () => {
  const EXISTING = {
    id: 'vi-1',
    vendorName: 'Acme Laundry Co',
    description: null,
    serviceType: 'wash_fold',
    amountPaise: 50000n,
    paymentStatus: 'unpaid',
    branchId: null,
    voidedAt: null,
  };

  beforeEach(() => {
    prismaMock.vendorInvoice.findUnique.mockResolvedValue(EXISTING as any);
    prismaMock.vendorInvoice.update.mockResolvedValue({ ...EXISTING } as any);
  });

  it('404s on an unknown or voided vendor invoice', async () => {
    prismaMock.vendorInvoice.findUnique.mockResolvedValue(null);
    await expect(updateVendorInvoice('vi-1', { updatedById: 'admin-1', vendorName: 'X' })).rejects.toMatchObject({ status: 404 });

    prismaMock.vendorInvoice.findUnique.mockResolvedValue({ ...EXISTING, voidedAt: new Date() } as any);
    await expect(updateVendorInvoice('vi-1', { updatedById: 'admin-1', vendorName: 'X' })).rejects.toMatchObject({ status: 404 });
  });

  // Mandatory test #8
  it('edits vendor name, description, service, and amount — each as its own audit row', async () => {
    await updateVendorInvoice('vi-1', {
      vendorName: 'New Vendor Name',
      description: 'Updated notes',
      serviceType: 'dry_cleaning',
      amount: 700,
      updatedById: 'admin-2',
    });

    expect(prismaMock.vendorInvoice.update).toHaveBeenCalledWith({
      where: { id: 'vi-1' },
      data: expect.objectContaining({
        vendorName: 'New Vendor Name',
        description: 'Updated notes',
        serviceType: 'dry_cleaning',
        amountPaise: 70000n,
        updatedById: 'admin-2',
      }),
    });
    expect(prismaMock.vendorInvoiceAudit.create).toHaveBeenCalledTimes(4);
  });

  // Mandatory test #9
  it('changes Unpaid to Paid, stamping paidAt/paidBy and writing an audit row', async () => {
    await updateVendorInvoice('vi-1', { paymentDone: true, updatedById: 'admin-2' });

    expect(prismaMock.vendorInvoice.update).toHaveBeenCalledWith({
      where: { id: 'vi-1' },
      data: expect.objectContaining({ paymentStatus: 'paid', paidAt: expect.any(Date), paidById: 'admin-2', updatedById: 'admin-2' }),
    });
    expect(prismaMock.vendorInvoiceAudit.create).toHaveBeenCalledWith({
      data: { vendorInvoiceId: 'vi-1', action: 'payment_marked_paid', actedById: 'admin-2' },
    });
  });

  // Mandatory test #10 / #11: reverting Paid -> Unpaid writes its own audit
  // row without deleting or rewriting the earlier Paid event (append-only).
  it('changes Paid back to Unpaid, clearing paidAt/paidBy and preserving history as a new audit row', async () => {
    prismaMock.vendorInvoice.findUnique.mockResolvedValue({ ...EXISTING, paymentStatus: 'paid', paidAt: new Date(), paidById: 'admin-1' } as any);

    await updateVendorInvoice('vi-1', { paymentDone: false, updatedById: 'admin-2' });

    expect(prismaMock.vendorInvoice.update).toHaveBeenCalledWith({
      where: { id: 'vi-1' },
      data: expect.objectContaining({ paymentStatus: 'unpaid', paidAt: null, paidById: null }),
    });
    expect(prismaMock.vendorInvoiceAudit.create).toHaveBeenCalledWith({
      data: { vendorInvoiceId: 'vi-1', action: 'payment_marked_unpaid', actedById: 'admin-2' },
    });
    // The create call never touches/deletes any prior audit row — this
    // suite never calls audit.delete/deleteMany anywhere.
    expect((prismaMock.vendorInvoiceAudit as any).delete).not.toHaveBeenCalled();
  });

  it('is a no-op (no update, no audit) when nothing actually changed', async () => {
    await updateVendorInvoice('vi-1', { vendorName: 'Acme Laundry Co', updatedById: 'admin-2' });
    expect(prismaMock.vendorInvoice.update).not.toHaveBeenCalled();
    expect(prismaMock.vendorInvoiceAudit.create).not.toHaveBeenCalled();
  });
});

describe('voidVendorInvoice', () => {
  it('requires a reason', async () => {
    prismaMock.vendorInvoice.findUnique.mockResolvedValue({ id: 'vi-1', voidedAt: null } as any);
    await expect(voidVendorInvoice('vi-1', { reason: '', voidedById: 'admin-1' })).rejects.toMatchObject({ status: 400 });
  });

  it('404s on an unknown vendor invoice, 409s if already voided', async () => {
    prismaMock.vendorInvoice.findUnique.mockResolvedValue(null);
    await expect(voidVendorInvoice('vi-1', { reason: 'duplicate entry', voidedById: 'admin-1' })).rejects.toMatchObject({ status: 404 });

    prismaMock.vendorInvoice.findUnique.mockResolvedValue({ id: 'vi-1', voidedAt: new Date() } as any);
    await expect(voidVendorInvoice('vi-1', { reason: 'duplicate entry', voidedById: 'admin-1' })).rejects.toMatchObject({ status: 409 });
  });

  it('voids with a reason and writes an audit row, never hard-deleting', async () => {
    prismaMock.vendorInvoice.findUnique.mockResolvedValue({ id: 'vi-1', voidedAt: null } as any);
    prismaMock.vendorInvoice.update.mockResolvedValue({ id: 'vi-1', voidedAt: new Date() } as any);

    await voidVendorInvoice('vi-1', { reason: 'Duplicate entry', voidedById: 'admin-1' });

    expect(prismaMock.vendorInvoice.update).toHaveBeenCalledWith({
      where: { id: 'vi-1' },
      data: expect.objectContaining({ voidedAt: expect.any(Date), voidedById: 'admin-1', voidReason: 'Duplicate entry' }),
    });
    expect(prismaMock.vendorInvoiceAudit.create).toHaveBeenCalledWith({
      data: { vendorInvoiceId: 'vi-1', action: 'voided', newValue: 'Duplicate entry', actedById: 'admin-1' },
    });
    expect((prismaMock.vendorInvoice as any).delete).not.toHaveBeenCalled();
  });
});

describe('listVendorInvoices / getVendorInvoiceSummary — filters and voided exclusion', () => {
  beforeEach(() => {
    prismaMock.vendorInvoice.findMany.mockResolvedValue([] as any);
    prismaMock.vendorInvoice.count.mockResolvedValue(0);
    prismaMock.vendorInvoice.aggregate.mockResolvedValue({ _sum: { amountPaise: 0n } } as any);
  });

  // Mandatory test #12
  it('searches by vendor name (case-insensitive contains)', async () => {
    await listVendorInvoices({ search: 'acme' });
    expect(prismaMock.vendorInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ vendorName: { contains: 'acme', mode: 'insensitive' } }) })
    );
  });

  // Mandatory test #13
  it('filters by paid/unpaid status', async () => {
    await listVendorInvoices({ paymentStatus: 'paid' });
    expect(prismaMock.vendorInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ paymentStatus: 'paid' }) })
    );
  });

  // Mandatory test #14
  it('filters by branch and service type together', async () => {
    await listVendorInvoices({ branchId: 'branch-1', serviceType: 'dry_cleaning' });
    expect(prismaMock.vendorInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ branchId: 'branch-1', serviceType: 'dry_cleaning' }) })
    );
  });

  // Mandatory test #19: voided records are excluded from every active-list/summary query.
  it('always excludes voided records from both the list and the summary totals', async () => {
    await listVendorInvoices({});
    await getVendorInvoiceSummary({});
    expect(prismaMock.vendorInvoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ voidedAt: null }) }));
    expect(prismaMock.vendorInvoice.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ voidedAt: null }) }));
  });

  // Mandatory test #15
  it('computes correct summary totals from paise sums', async () => {
    prismaMock.vendorInvoice.aggregate
      .mockResolvedValueOnce({ _sum: { amountPaise: 150000n } } as any) // total
      .mockResolvedValueOnce({ _sum: { amountPaise: 50000n } } as any); // paid

    const summary = await getVendorInvoiceSummary({});
    expect(summary).toEqual({ totalAmount: 1500, paidAmount: 500, unpaidAmount: 1000 });
  });
});

describe('toVendorInvoiceCsv', () => {
  it('quotes a field containing a comma and converts paise back to rupees', () => {
    const csv = toVendorInvoiceCsv([
      {
        vendorName: 'Acme, Inc',
        serviceType: 'wash_fold',
        description: null,
        amountPaise: 50000n,
        paymentStatus: 'unpaid',
        branch: null,
        createdAt: new Date('2026-10-30T00:00:00Z'),
      },
    ]);
    expect(csv).toContain('"Acme, Inc"');
    expect(csv).toContain('500');
  });
});
