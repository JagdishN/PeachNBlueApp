import prisma from '../prisma/client';
import { getInvoicePaymentSummary, describeSettlement } from './paymentLedgerService';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export type AgingCategory = 'not_yet_due' | '1-7' | '8-15' | '16-30' | 'over_30';

const categorizeAging = (daysOverdue: number): AgingCategory => {
  if (daysOverdue <= 0) return 'not_yet_due';
  if (daysOverdue <= 7) return '1-7';
  if (daysOverdue <= 15) return '8-15';
  if (daysOverdue <= 30) return '16-30';
  return 'over_30';
};

export interface InvoiceAgingRow {
  branchId: string;
  branchName: string;
  customerId: string;
  customerName: string;
  orderId: string;
  orderNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date | null;
  originalAmount: number;
  amountPaid: number;
  // Admin Payment Override — sum of active (non-reversed) InvoiceAdjustment
  // waivers on this invoice. Reported separately from amountPaid, which
  // stays real-money-only ("actual payment receipts" must stay
  // distinguishable from a waived amount).
  waivedAmount: number;
  outstanding: number;
  paymentStatus: 'unpaid' | 'partially_paid' | 'paid';
  // "Paid in Full" vs "Closed with Adjustment" — internal-audit-only
  // distinction (spec section 4); customer-facing paymentStatus above
  // stays the general 'paid' label either way.
  internalSettlementLabel: 'unpaid' | 'partially_paid' | 'paid_in_full' | 'closed_with_adjustment';
  lastPaymentDate: Date | null;
  paymentMethods: string[];
  razorpayReferences: string[];
  bankUpiReferences: string[];
  daysOverdue: number;
  agingCategory: AgingCategory;
  reminderCount: number;
  lastReminderDate: Date | null;
  // Values: verified | pending_verification | n/a (no bank_upi payment on this invoice at all)
  verificationStatus: 'verified' | 'pending_verification' | 'n/a';
}

export interface InvoiceAgingFilters {
  branchId?: string;
  customerId?: string;
  paymentStatus?: 'unpaid' | 'partially_paid' | 'paid';
  invoiceDateFrom?: Date;
  invoiceDateTo?: Date;
  outstandingMin?: number;
  outstandingMax?: number;
  agingCategory?: AgingCategory;
}

// Outstanding-dues rework, section 11 — "an invoice-level outstanding
// report suitable for Peach & Blue's internal financial audit." Scoped to
// non-monthly-billing orders (the aging/statement concept doesn't apply to
// the separate LedgerEntry running-balance model — see ledgerService.ts's
// own getAgingReport for that one). "Reports must not double-count
// previous dues carried forward to newer invoices" — satisfied structurally
// here: each invoice's own `amount`/outstanding is reported once, and
// InvoicePreviousDuesLine is never summed into this (it's a presentation
// snapshot on a DIFFERENT invoice, not this one's own financial figures).
export const getInvoiceAgingReport = async (filters: InvoiceAgingFilters = {}): Promise<InvoiceAgingRow[]> => {
  const invoices = await prisma.invoice.findMany({
    where: {
      order: {
        billingMode: { not: 'monthly_billing' },
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        customer: filters.branchId ? { branchId: filters.branchId } : undefined,
      },
      ...(filters.invoiceDateFrom || filters.invoiceDateTo
        ? {
            createdAt: {
              ...(filters.invoiceDateFrom ? { gte: filters.invoiceDateFrom } : {}),
              ...(filters.invoiceDateTo ? { lte: filters.invoiceDateTo } : {}),
            },
          }
        : {}),
    },
    include: {
      order: { include: { customer: { include: { branch: true } } } },
      payments: true,
    },
  });

  const now = new Date();
  const rows: InvoiceAgingRow[] = [];

  for (const invoice of invoices) {
    const summary = await getInvoicePaymentSummary(prisma, invoice.id);
    const outstanding = Number(summary.outstandingPaise) / 100;
    const amountPaid = Number(summary.allocatedPaise) / 100;
    const waivedAmount = Number(summary.waivedPaise) / 100;
    const original = Number(invoice.amount ?? 0);

    if (filters.paymentStatus && summary.status !== filters.paymentStatus) continue;
    if (filters.outstandingMin !== undefined && outstanding < filters.outstandingMin) continue;
    if (filters.outstandingMax !== undefined && outstanding > filters.outstandingMax) continue;

    const verifiedPayments = invoice.payments.filter((p) => p.verificationStatus === 'verified' && p.status !== 'refunded');
    const pendingUpi = invoice.payments.some((p) => p.paymentSource === 'bank_upi' && p.verificationStatus === 'pending');
    const anyBankUpi = invoice.payments.some((p) => p.paymentSource === 'bank_upi');
    const lastPaymentDate =
      verifiedPayments.length > 0 ? verifiedPayments.reduce((latest, p) => (p.createdAt > latest ? p.createdAt : latest), verifiedPayments[0].createdAt) : null;

    const daysOverdue = invoice.dueDate && outstanding > 0 ? Math.floor((now.getTime() - invoice.dueDate.getTime()) / MS_PER_DAY) : 0;
    const agingCategory = categorizeAging(daysOverdue);
    if (filters.agingCategory && agingCategory !== filters.agingCategory) continue;

    const reminders = await prisma.paymentReminderLog.findMany({
      where: { customerId: invoice.order.customerId, invoiceIds: { has: invoice.id } },
      orderBy: { sentAt: 'desc' },
    });

    rows.push({
      branchId: invoice.order.customer.branchId,
      branchName: invoice.order.customer.branch.branchName,
      customerId: invoice.order.customerId,
      customerName: invoice.order.customer.fullName,
      orderId: invoice.orderId,
      orderNumber: invoice.order.orderNumber,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.createdAt,
      dueDate: invoice.dueDate,
      originalAmount: original,
      amountPaid,
      waivedAmount,
      outstanding,
      paymentStatus: summary.status,
      internalSettlementLabel: describeSettlement(summary),
      lastPaymentDate,
      paymentMethods: Array.from(new Set(verifiedPayments.map((p) => p.paymentMethod))),
      razorpayReferences: Array.from(new Set(verifiedPayments.map((p) => p.razorpayPaymentId).filter((v): v is string => Boolean(v)))),
      bankUpiReferences: Array.from(new Set(invoice.payments.map((p) => p.utrReference).filter((v): v is string => Boolean(v)))),
      daysOverdue: Math.max(0, daysOverdue),
      agingCategory,
      reminderCount: reminders.length,
      lastReminderDate: reminders[0]?.sentAt ?? null,
      verificationStatus: pendingUpi ? 'pending_verification' : anyBankUpi ? 'verified' : 'n/a',
    });
  }

  return rows;
};

export interface StatementEntry {
  type: 'invoice' | 'payment' | 'allocation' | 'adjustment';
  date: Date;
  description: string;
  debit: number; // increases what's owed (a new invoice)
  credit: number; // decreases what's owed (a payment allocation)
  runningBalance: number;
}

export interface CustomerStatement {
  customerId: string;
  customerName: string;
  entries: StatementEntry[];
  closingBalance: number;
}

// "Where practical, provide a customer account statement export containing
// invoices, receipts, allocations, adjustments, and running balance" —
// built from Invoice (debits) and PaymentAllocation (credits, NOT the raw
// Payment amount — a multi-invoice payment's allocations are what actually
// reduced each invoice's balance, and this must not double-count a
// previous-dues carry-forward, which is why it reads InvoicePreviousDuesLine
// nowhere in this function at all).
export const getCustomerStatement = async (customerId: string): Promise<CustomerStatement> => {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    const err = new Error('Customer not found.') as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  const invoices = await prisma.invoice.findMany({
    where: { order: { customerId, billingMode: { not: 'monthly_billing' } } },
    include: { order: { select: { orderNumber: true } } },
  });

  const allocations = await prisma.paymentAllocation.findMany({
    where: { invoice: { order: { customerId } } },
    include: { payment: { select: { paymentMethod: true, paymentSource: true } } },
  });

  // Admin Payment Override — active (non-reversed) waivers also reduce the
  // running balance, same as a payment allocation, but reported under a
  // distinct 'adjustment' type ("invoices, receipts, allocations,
  // adjustments, and running balance" — spec's own wording). A reversed
  // waiver is intentionally excluded here: its reversal already restored
  // the balance, so it must not count twice.
  const adjustments = await prisma.invoiceAdjustment.findMany({
    where: { invoice: { order: { customerId } }, reversedAt: null },
    include: { invoice: { select: { invoiceNumber: true } } },
  });

  const rawEntries: Omit<StatementEntry, 'runningBalance'>[] = [];

  for (const invoice of invoices) {
    rawEntries.push({
      type: 'invoice',
      date: invoice.createdAt,
      description: `Invoice ${invoice.invoiceNumber} (Order ${invoice.order.orderNumber})`,
      debit: Number(invoice.amount ?? 0),
      credit: 0,
    });
  }

  for (const allocation of allocations) {
    rawEntries.push({
      type: 'allocation',
      date: allocation.createdAt,
      description: `Payment allocated (${allocation.payment.paymentSource}/${allocation.payment.paymentMethod})`,
      debit: 0,
      credit: Number(allocation.allocatedPaise) / 100,
    });
  }

  for (const adjustment of adjustments) {
    rawEntries.push({
      type: 'adjustment',
      date: adjustment.createdAt,
      description: `Waiver on invoice ${adjustment.invoice.invoiceNumber} (${adjustment.reasonCategory}): ${adjustment.reason}`,
      debit: 0,
      credit: Number(adjustment.amountPaise) / 100,
    });
  }

  rawEntries.sort((a, b) => a.date.getTime() - b.date.getTime());

  let balance = 0;
  const entries: StatementEntry[] = rawEntries.map((entry) => {
    balance += entry.debit - entry.credit;
    return { ...entry, runningBalance: balance };
  });

  return { customerId, customerName: customer.fullName, entries, closingBalance: balance };
};

// Plain CSV, hand-rolled (no new dependency, same approach as the
// bank-statement importer) — no CSV/export infrastructure existed
// anywhere in this codebase before this rework (Phase 1 audit finding).
export const toAgingCsv = (rows: InvoiceAgingRow[]): string => {
  const header = [
    'Branch', 'Customer ID', 'Customer Name', 'Order ID', 'Invoice Number', 'Invoice Date', 'Due Date',
    'Original Amount', 'Amount Paid', 'Waived Amount', 'Outstanding', 'Payment Status', 'Internal Settlement',
    'Last Payment Date', 'Payment Methods', 'Razorpay References', 'Bank UPI References', 'Days Overdue',
    'Aging Category', 'Reminder Count', 'Last Reminder Date', 'Verification Status',
  ];
  const escape = (value: string): string => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = rows.map((row) =>
    [
      row.branchName, row.customerId, row.customerName, row.orderId, row.invoiceNumber,
      row.invoiceDate.toISOString(), row.dueDate?.toISOString() ?? '', String(row.originalAmount),
      String(row.amountPaid), String(row.waivedAmount), String(row.outstanding), row.paymentStatus,
      row.internalSettlementLabel, row.lastPaymentDate?.toISOString() ?? '',
      row.paymentMethods.join('; '), row.razorpayReferences.join('; '), row.bankUpiReferences.join('; '),
      String(row.daysOverdue), row.agingCategory, String(row.reminderCount), row.lastReminderDate?.toISOString() ?? '',
      row.verificationStatus,
    ]
      .map(escape)
      .join(',')
  );
  return [header.join(','), ...lines].join('\n');
};
