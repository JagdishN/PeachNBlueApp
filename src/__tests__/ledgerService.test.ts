import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));

import prisma from '../prisma/client';
import { sendNotification } from '../services/notificationService';
import { generateMonthlyStatements } from '../services/ledgerService';
import { MSG91_TEMPLATES } from '../constants/msg91Templates';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const sendNotificationMock = sendNotification as jest.Mock;

beforeEach(() => {
  mockReset(prismaMock);
  sendNotificationMock.mockReset();
  sendNotificationMock.mockResolvedValue(undefined);
});

// monthly_statement_ready — real Meta-approved shape (CLAUDE.md): {{1}}
// name, {{2}} statement period, {{3}} total due (the current running ledger
// balance, same value getAgingReport/sendReminder already use).
describe('generateMonthlyStatements', () => {
  const CUSTOMER = {
    id: 'customer-1',
    fullName: 'Test Customer',
    phoneNumber: '9999999999',
    whatsappNumber: null,
    billingMode: 'monthly_billing',
    branch: { whatsappNumber: '917013725151' },
  };

  it('sends a statement to a monthly-billing customer with a positive outstanding balance', async () => {
    prismaMock.customer.findMany.mockResolvedValue([CUSTOMER] as any);
    prismaMock.ledgerEntry.findFirst.mockResolvedValue({ balanceAfter: 1250 } as any);

    const result = await generateMonthlyStatements();

    expect(sendNotificationMock).toHaveBeenCalledWith(
      CUSTOMER,
      'monthly_statement',
      {
        name: MSG91_TEMPLATES.monthlyStatementReady.name,
        language: MSG91_TEMPLATES.monthlyStatementReady.language,
        bodyVariables: [CUSTOMER.fullName, expect.any(String), '1250'],
      }
    );
    expect(result).toEqual({ sent: 1, skipped: 0 });
  });

  it('skips a customer with a zero balance — nothing meaningful to state', async () => {
    prismaMock.customer.findMany.mockResolvedValue([CUSTOMER] as any);
    prismaMock.ledgerEntry.findFirst.mockResolvedValue({ balanceAfter: 0 } as any);

    const result = await generateMonthlyStatements();

    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, skipped: 1 });
  });

  it('skips a customer with a negative (credit) balance', async () => {
    prismaMock.customer.findMany.mockResolvedValue([CUSTOMER] as any);
    prismaMock.ledgerEntry.findFirst.mockResolvedValue({ balanceAfter: -50 } as any);

    const result = await generateMonthlyStatements();

    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, skipped: 1 });
  });

  it('treats a customer with no ledger entries at all as a zero balance (skipped, not a crash)', async () => {
    prismaMock.customer.findMany.mockResolvedValue([CUSTOMER] as any);
    prismaMock.ledgerEntry.findFirst.mockResolvedValue(null);

    const result = await generateMonthlyStatements();

    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, skipped: 1 });
  });

  it('only queries monthly-billing customers', async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);

    await generateMonthlyStatements();

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { billingMode: 'monthly_billing' } })
    );
  });

  it('processes multiple customers independently, summing sent/skipped correctly', async () => {
    const paidUp = { ...CUSTOMER, id: 'customer-2', fullName: 'Paid Up Customer' };
    prismaMock.customer.findMany.mockResolvedValue([CUSTOMER, paidUp] as any);
    prismaMock.ledgerEntry.findFirst
      .mockResolvedValueOnce({ balanceAfter: 500 } as any)
      .mockResolvedValueOnce({ balanceAfter: 0 } as any);

    const result = await generateMonthlyStatements();

    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sent: 1, skipped: 1 });
  });
});
