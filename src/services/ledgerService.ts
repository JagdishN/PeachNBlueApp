import prisma from '../prisma/client';
import { sendNotification } from './notificationService';

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

export const sendReminder = async (customerId: string): Promise<void> => {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });

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

  await sendNotification(
    customer,
    'payment_reminder',
    `Your Peach & Blue account has an outstanding balance of ₹${balance}. Please settle at your earliest convenience.`
  );
};
