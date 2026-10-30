import prisma from '../prisma/client';
import { toPaise, fromPaise } from '../utils/money';

// Third-party vendor invoice management, Feature 2 — internal expense
// tracking/audit only. Deliberately has NO relation to Invoice/Payment/
// Order/Customer anywhere in this file (spec section 7: "keep vendor
// invoices completely separate from customer invoices and the customer
// receivables ledger") — this is its own small, self-contained CRUD, not
// an extension of the payment-ledger machinery the rest of this directory
// concerns itself with.

export const VENDOR_SERVICE_TYPES = ['wash_fold', 'wash_fold_iron', 'dry_cleaning'] as const;
export type VendorServiceType = (typeof VENDOR_SERVICE_TYPES)[number];

export const VENDOR_SERVICE_TYPE_LABELS: Record<VendorServiceType, string> = {
  wash_fold: 'Wash & Fold',
  wash_fold_iron: 'Wash, Fold & Ironing',
  dry_cleaning: 'Dry Cleaning',
};

const makeError = (message: string, status: number): Error => {
  const err = new Error(message) as Error & { status?: number };
  err.status = status;
  return err;
};

export interface VendorInvoiceFilters {
  branchId?: string;
  search?: string;
  paymentStatus?: 'all' | 'paid' | 'unpaid';
  serviceType?: VendorServiceType;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}

const buildWhere = (filters: VendorInvoiceFilters, includeVoided: boolean) => ({
  ...(includeVoided ? {} : { voidedAt: null }),
  ...(filters.branchId ? { branchId: filters.branchId } : {}),
  ...(filters.search ? { vendorName: { contains: filters.search, mode: 'insensitive' as const } } : {}),
  ...(filters.paymentStatus && filters.paymentStatus !== 'all' ? { paymentStatus: filters.paymentStatus } : {}),
  ...(filters.serviceType ? { serviceType: filters.serviceType } : {}),
  ...(filters.dateFrom || filters.dateTo
    ? {
        createdAt: {
          ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
          ...(filters.dateTo ? { lte: filters.dateTo } : {}),
        },
      }
    : {}),
});

export const listVendorInvoices = async (filters: VendorInvoiceFilters) => {
  const where = buildWhere(filters, false);
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const [rows, total] = await Promise.all([
    prisma.vendorInvoice.findMany({
      where,
      include: { branch: { select: { branchName: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.vendorInvoice.count({ where }),
  ]);

  return { rows, total, limit, offset };
};

// Spec section 9: "Calculate these from the selected filters and
// accessible records. Do not count voided records in active financial
// totals." Computed over the SAME filter set as the list above, but
// unpaginated — a summary card must reflect everything matching the
// filters, not just the current page.
export const getVendorInvoiceSummary = async (filters: VendorInvoiceFilters) => {
  const where = buildWhere(filters, false);

  const [totalAgg, paidAgg] = await Promise.all([
    prisma.vendorInvoice.aggregate({ where, _sum: { amountPaise: true } }),
    prisma.vendorInvoice.aggregate({ where: { ...where, paymentStatus: 'paid' }, _sum: { amountPaise: true } }),
  ]);

  const totalAmount = fromPaise(totalAgg._sum.amountPaise ?? 0n);
  const paidAmount = fromPaise(paidAgg._sum.amountPaise ?? 0n);
  return { totalAmount, paidAmount, unpaidAmount: totalAmount - paidAmount };
};

export const getVendorInvoice = (id: string) =>
  prisma.vendorInvoice.findUnique({
    where: { id },
    include: { branch: { select: { branchName: true } } },
  });

export interface CreateVendorInvoiceInput {
  vendorName: string;
  description?: string | null;
  serviceType: VendorServiceType;
  amount: number;
  paymentDone?: boolean;
  branchId?: string | null;
  createdById: string;
}

const validateServiceType = (serviceType: unknown): void => {
  if (!VENDOR_SERVICE_TYPES.includes(serviceType as VendorServiceType)) {
    throw makeError(`serviceType must be one of: ${VENDOR_SERVICE_TYPES.join(', ')}`, 400);
  }
};

export const createVendorInvoice = async (input: CreateVendorInvoiceInput) => {
  const vendorName = input.vendorName?.trim();
  if (!vendorName) {
    throw makeError('vendorName is required.', 400);
  }
  validateServiceType(input.serviceType);
  if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0) {
    throw makeError('amount must be a positive number.', 400);
  }

  const paymentDone = input.paymentDone ?? false;
  const now = new Date();

  const vendorInvoice = await prisma.vendorInvoice.create({
    data: {
      vendorName,
      description: input.description?.trim() || null,
      serviceType: input.serviceType,
      amountPaise: toPaise(input.amount),
      paymentStatus: paymentDone ? 'paid' : 'unpaid',
      branchId: input.branchId ?? null,
      createdById: input.createdById,
      paidAt: paymentDone ? now : null,
      paidById: paymentDone ? input.createdById : null,
    },
  });

  await prisma.vendorInvoiceAudit.create({
    data: { vendorInvoiceId: vendorInvoice.id, action: 'created', actedById: input.createdById },
  });
  if (paymentDone) {
    await prisma.vendorInvoiceAudit.create({
      data: { vendorInvoiceId: vendorInvoice.id, action: 'payment_marked_paid', actedById: input.createdById },
    });
  }

  return vendorInvoice;
};

export interface UpdateVendorInvoiceInput {
  vendorName?: string;
  description?: string | null;
  serviceType?: VendorServiceType;
  amount?: number;
  paymentDone?: boolean;
  branchId?: string | null;
  updatedById: string;
}

// Spec section 11: every field edit AND every payment-status transition is
// its own audit row with old/new values (strings — the two fields involved
// are differently typed, same reasoning CustomerDiscountAudit already
// uses). Reversing Paid back to Unpaid preserves the earlier Paid event —
// satisfied structurally here since audit rows are append-only; this
// function never deletes or rewrites a prior row.
export const updateVendorInvoice = async (id: string, input: UpdateVendorInvoiceInput) => {
  const existing = await prisma.vendorInvoice.findUnique({ where: { id } });
  if (!existing || existing.voidedAt) {
    throw makeError('Vendor invoice not found.', 404);
  }

  const data: Record<string, unknown> = {};
  const auditRows: { field: string; oldValue: string; newValue: string }[] = [];

  if (input.vendorName !== undefined) {
    const vendorName = input.vendorName.trim();
    if (!vendorName) throw makeError('vendorName cannot be empty.', 400);
    if (vendorName !== existing.vendorName) {
      auditRows.push({ field: 'vendorName', oldValue: existing.vendorName, newValue: vendorName });
      data.vendorName = vendorName;
    }
  }
  if (input.description !== undefined) {
    const description = input.description?.trim() || null;
    if (description !== existing.description) {
      auditRows.push({ field: 'description', oldValue: existing.description ?? '', newValue: description ?? '' });
      data.description = description;
    }
  }
  if (input.serviceType !== undefined) {
    validateServiceType(input.serviceType);
    if (input.serviceType !== existing.serviceType) {
      auditRows.push({ field: 'serviceType', oldValue: existing.serviceType, newValue: input.serviceType });
      data.serviceType = input.serviceType;
    }
  }
  if (input.amount !== undefined) {
    if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0) {
      throw makeError('amount must be a positive number.', 400);
    }
    const amountPaise = toPaise(input.amount);
    if (amountPaise !== existing.amountPaise) {
      auditRows.push({
        field: 'amountPaise',
        oldValue: String(existing.amountPaise),
        newValue: String(amountPaise),
      });
      data.amountPaise = amountPaise;
    }
  }
  if (input.branchId !== undefined && input.branchId !== existing.branchId) {
    auditRows.push({ field: 'branchId', oldValue: existing.branchId ?? '', newValue: input.branchId ?? '' });
    data.branchId = input.branchId;
  }

  const paymentStatusAudits: { action: string }[] = [];
  if (input.paymentDone !== undefined) {
    const wasPaid = existing.paymentStatus === 'paid';
    if (input.paymentDone && !wasPaid) {
      data.paymentStatus = 'paid';
      data.paidAt = new Date();
      data.paidById = input.updatedById;
      paymentStatusAudits.push({ action: 'payment_marked_paid' });
    } else if (!input.paymentDone && wasPaid) {
      // ON -> OFF: spec requires the UI to confirm before calling this —
      // enforced client-side (mobile confirmation dialog), not re-asked
      // here. The earlier Paid event (paidAt/paidBy at the time) stays
      // preserved on its own audit row below; only the live
      // paymentStatus/paidAt/paidBy on the main row revert.
      data.paymentStatus = 'unpaid';
      data.paidAt = null;
      data.paidById = null;
      paymentStatusAudits.push({ action: 'payment_marked_unpaid' });
    }
  }

  if (Object.keys(data).length === 0) {
    return existing;
  }

  data.updatedById = input.updatedById;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.vendorInvoice.update({ where: { id }, data });
    for (const audit of auditRows) {
      await tx.vendorInvoiceAudit.create({
        data: { vendorInvoiceId: id, action: 'updated', field: audit.field, oldValue: audit.oldValue, newValue: audit.newValue, actedById: input.updatedById },
      });
    }
    for (const audit of paymentStatusAudits) {
      await tx.vendorInvoiceAudit.create({
        data: { vendorInvoiceId: id, action: audit.action, actedById: input.updatedById },
      });
    }
    return row;
  });

  return updated;
};

export interface VoidVendorInvoiceInput {
  reason: string;
  voidedById: string;
}

// Spec section 14: "Do not hard-delete... implement an Admin-only Void
// action with a mandatory reason, and exclude voided records from active
// summaries while retaining them for audit." listVendorInvoices/
// getVendorInvoiceSummary already exclude voidedAt-set rows by default
// (buildWhere above); the row and its full audit history stay queryable
// directly by id regardless.
export const voidVendorInvoice = async (id: string, input: VoidVendorInvoiceInput) => {
  if (!input.reason || !input.reason.trim()) {
    throw makeError('A reason is required to void a vendor invoice.', 400);
  }

  const existing = await prisma.vendorInvoice.findUnique({ where: { id } });
  if (!existing) {
    throw makeError('Vendor invoice not found.', 404);
  }
  if (existing.voidedAt) {
    throw makeError('This vendor invoice is already voided.', 409);
  }

  return prisma.$transaction(async (tx) => {
    const row = await tx.vendorInvoice.update({
      where: { id },
      data: { voidedAt: new Date(), voidedById: input.voidedById, voidReason: input.reason },
    });
    await tx.vendorInvoiceAudit.create({
      data: { vendorInvoiceId: id, action: 'voided', newValue: input.reason, actedById: input.voidedById },
    });
    return row;
  });
};

export const listVendorInvoiceAudit = (id: string) =>
  prisma.vendorInvoiceAudit.findMany({
    where: { vendorInvoiceId: id },
    orderBy: { actedAt: 'desc' },
    include: { actedBy: { select: { id: true, fullName: true } } },
  });

// Hand-rolled CSV, same shape as reportingService.ts::toAgingCsv — no new
// dependency, same approach already established for export in this
// codebase.
export const toVendorInvoiceCsv = (
  rows: Array<{
    vendorName: string;
    serviceType: string;
    description: string | null;
    amountPaise: bigint;
    paymentStatus: string;
    branch: { branchName: string } | null;
    createdAt: Date;
  }>
): string => {
  const header = ['Vendor Name', 'Service Type', 'Description', 'Amount', 'Payment Status', 'Branch', 'Record Date'];
  const escape = (value: string): string => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = rows.map((row) =>
    [
      row.vendorName,
      VENDOR_SERVICE_TYPE_LABELS[row.serviceType as VendorServiceType] ?? row.serviceType,
      row.description ?? '',
      String(fromPaise(row.amountPaise)),
      row.paymentStatus,
      row.branch?.branchName ?? '',
      row.createdAt.toISOString(),
    ]
      .map(escape)
      .join(',')
  );
  return [header.join(','), ...lines].join('\n');
};
