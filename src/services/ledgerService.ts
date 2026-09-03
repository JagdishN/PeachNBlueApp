import prisma from '../prisma/client';
import { sendNotification } from './notificationService';
import { MSG91_TEMPLATES } from '../constants/msg91Templates';

// Records both an entry_type='charge'/'payment' row AND its running
// balance_after atomically — a payment update and its ledger entry must
// both succeed or both roll back together (Technical Design Document 7.2).
const recordEntry = async (
  customerId: string,
  orderId: string | undefined,
  entryType: 'charge' | 'payment' | 'adjustment',
  signedAmount: number,
  description: string
) => {
  return prisma.$transaction(async (tx) => {
    const lastEntry = await tx.ledgerEntry.findFirst({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });

    const balanceAfter = Number(lastEntry?.balanceAfter ?? 0) + signedAmount;

    return tx.ledgerEntry.create({
      data: {
        customerId,
        orderId,
        entryType,
        amount: signedAmount,
        balanceAfter,
        description,
      },
    });
  });
};

export const recordCharge = (customerId: string, orderId: string, amount: number, description: string) =>
  recordEntry(customerId, orderId, 'charge', amount, description);

export const recordPayment = (customerId: string, orderId: string | undefined, amount: number, description: string) =>
  recordEntry(customerId, orderId, 'payment', -amount, description);

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export interface AgingRow {
  customerId: string;
  customerName: string;
  locationLabel: string;
  outstandingBalance: number;
  daysSinceLastCharge: number | null;
}

// Outstanding balance per monthly-billing customer + days since their most
// recent charge, sorted by days overdue. Reused by the on-demand "send
// reminder" action here and, later, by the overdue-reminder cron.
export const getAgingReport = async (branchId?: string): Promise<AgingRow[]> => {
  const customers = await prisma.customer.findMany({
    where: {
      billingMode: 'monthly_billing',
      ...(branchId ? { branchId } : {}),
    },
  });

  const rows = await Promise.all(
    customers.map(async (customer): Promise<AgingRow> => {
      const lastEntry = await prisma.ledgerEntry.findFirst({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'desc' },
      });

      const lastCharge = await prisma.ledgerEntry.findFirst({
        where: { customerId: customer.id, entryType: 'charge' },
        orderBy: { createdAt: 'desc' },
      });

      const daysSinceLastCharge = lastCharge
        ? Math.floor((Date.now() - lastCharge.createdAt.getTime()) / MS_PER_DAY)
        : null;

      return {
        customerId: customer.id,
        customerName: customer.fullName,
        locationLabel: customer.locationLabel,
        outstandingBalance: Number(lastEntry?.balanceAfter ?? 0),
        daysSinceLastCharge,
      };
    })
  );

  return rows
    .filter((row) => row.outstandingBalance > 0)
    .sort((a, b) => (b.daysSinceLastCharge ?? 0) - (a.daysSinceLastCharge ?? 0));
};

export interface MonthlyStatementResult {
  sent: number;
  skipped: number;
}

// monthly_statement_ready — real Meta-approved shape confirmed 2026-09-02
// (the client's own dashboard-composed test, the send that first surfaced
// the missing-namespace bug): {{1}} name, {{2}} statement period, {{3}}
// total due. No header/button component, so this is a plain text
// notification — no statement PDF is generated (nothing in this template
// could carry one).
//
// "Total due" is the customer's current running ledger balance (same value
// getAgingReport/sendReminder already use) — a conventional running-balance
// statement (credit card/utility bill style) reports the current amount
// owed, not a re-summed "charges just in this period" figure that could
// disagree with the ledger's own balanceAfter running total. Customers with
// a zero/negative balance are skipped (same convention getAgingReport
// already uses) — nothing meaningful to state if nothing is owed.
export const generateMonthlyStatements = async (): Promise<MonthlyStatementResult> => {
  const customers = await prisma.customer.findMany({
    where: { billingMode: 'monthly_billing' },
    include: { branch: { select: { whatsappNumber: true } } },
  });

  // The month just ended, not the current (still in-progress) one — this
  // runs on the 1st of the month (see jobs/index.ts), so "now" is already
  // the new month.
  const now = new Date();
  const periodDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const periodLabel = periodDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  let sent = 0;
  let skipped = 0;

  // Sequential, not Promise.all — same reasoning as
  // reissueAllOpenInvoicesForCustomer (avoid bursting MSG91's rate limits
  // when there are many monthly-billing customers).
  for (const customer of customers) {
    const lastEntry = await prisma.ledgerEntry.findFirst({
      where: { customerId: customer.id },
      orderBy: { createdAt: 'desc' },
    });
    const balance = Number(lastEntry?.balanceAfter ?? 0);

    if (balance <= 0) {
      skipped += 1;
      continue;
    }

    await sendNotification(customer, 'monthly_statement', {
      name: MSG91_TEMPLATES.monthlyStatementReady.name,
      language: MSG91_TEMPLATES.monthlyStatementReady.language,
      bodyVariables: [customer.fullName, periodLabel, String(balance)],
    });
    sent += 1;
  }

  return { sent, skipped };
};

export const sendReminder = async (customerId: string): Promise<void> => {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { branch: { select: { whatsappNumber: true } } },
  });

  if (!customer) {
    const err = new Error('Customer not found.');
    (err as any).status = 404;
    throw err;
  }

  const lastEntry = await prisma.ledgerEntry.findFirst({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
  });

  const balance = Number(lastEntry?.balanceAfter ?? 0);

  await sendNotification(customer, 'payment_reminder', {
    name: MSG91_TEMPLATES.paymentReminder.name,
    language: MSG91_TEMPLATES.paymentReminder.language,
    bodyVariables: [customer.fullName, String(balance)],
  });
};
