import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

jest.mock('../prisma/client', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from '../prisma/client';
import { importBankStatementCsv, listUnmatchedBankTransactions } from '../services/bankStatementImportService';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
  prismaMock.bankTransaction.create.mockResolvedValue({} as any);
});

const CSV_HEADER = 'utr,amount,date,direction,description';

describe('importBankStatementCsv', () => {
  it('throws on a malformed header rather than silently importing garbage', async () => {
    await expect(importBankStatementCsv('wrong,header\nfoo,bar', 'acct-1', 'admin-1')).rejects.toThrow(
      'must include utr, amount, date, and direction'
    );
  });

  it('throws on an invalid amount in a row', async () => {
    const csv = `${CSV_HEADER}\nUTR1,not-a-number,2026-10-01,credit,test`;
    await expect(importBankStatementCsv(csv, 'acct-1', 'admin-1')).rejects.toThrow('invalid amount');
  });

  it('marks a UTR with no matching reported payment as unmatched', async () => {
    prismaMock.payment.findMany.mockResolvedValue([]);
    const csv = `${CSV_HEADER}\nUTR-NO-MATCH,500,2026-10-01,credit,test`;

    const summary = await importBankStatementCsv(csv, 'acct-1', 'admin-1');

    expect(summary).toEqual({ importBatchId: expect.any(String), totalRows: 1, matched: 0, ambiguous: 0, unmatched: 1, skippedDebits: 0 });
    expect(prismaMock.bankTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ matchStatus: 'unmatched', matchedPaymentId: null }) })
    );
  });

  it('matches a credit row to a single bank_upi payment with the same UTR and exact amount', async () => {
    prismaMock.payment.findMany.mockResolvedValue([{ id: 'payment-1', amountPaise: 50000n }] as any);
    const csv = `${CSV_HEADER}\nUTR-MATCH,500,2026-10-01,credit,test`;

    const summary = await importBankStatementCsv(csv, 'acct-1', 'admin-1');

    expect(summary.matched).toBe(1);
    expect(prismaMock.bankTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ matchStatus: 'matched', matchedPaymentId: 'payment-1' }) })
    );
  });

  // Spec section 7: "Do not automatically verify a payment solely because
  // its amount matches an invoice" — a UTR match with a DIFFERENT amount
  // must be flagged, not silently matched or silently dropped.
  it('flags a UTR match with a mismatched amount as ambiguous, not matched', async () => {
    prismaMock.payment.findMany.mockResolvedValue([{ id: 'payment-1', amountPaise: 60000n }] as any);
    const csv = `${CSV_HEADER}\nUTR-WRONG-AMOUNT,500,2026-10-01,credit,test`;

    const summary = await importBankStatementCsv(csv, 'acct-1', 'admin-1');

    expect(summary.ambiguous).toBe(1);
    expect(summary.matched).toBe(0);
  });

  it('flags multiple candidates for the same UTR as ambiguous rather than picking one', async () => {
    prismaMock.payment.findMany.mockResolvedValue([
      { id: 'payment-1', amountPaise: 50000n },
      { id: 'payment-2', amountPaise: 50000n },
    ] as any);
    const csv = `${CSV_HEADER}\nUTR-DUPLICATE,500,2026-10-01,credit,test`;

    const summary = await importBankStatementCsv(csv, 'acct-1', 'admin-1');

    expect(summary.ambiguous).toBe(1);
  });

  it('imports debit rows for record-keeping but never attempts to match them', async () => {
    const csv = `${CSV_HEADER}\nUTR-DEBIT,100,2026-10-01,debit,bank charge`;

    const summary = await importBankStatementCsv(csv, 'acct-1', 'admin-1');

    expect(summary.skippedDebits).toBe(1);
    expect(prismaMock.payment.findMany).not.toHaveBeenCalled();
    expect(prismaMock.bankTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ matchStatus: 'ignored' }) })
    );
  });

  it('tags every imported row with the same importBatchId', async () => {
    prismaMock.payment.findMany.mockResolvedValue([]);
    const csv = `${CSV_HEADER}\nUTR-A,100,2026-10-01,credit,a\nUTR-B,200,2026-10-02,credit,b`;

    await importBankStatementCsv(csv, 'acct-1', 'admin-1');

    const calls = prismaMock.bankTransaction.create.mock.calls;
    const batchIds = calls.map((c: any) => c[0].data.importBatchId);
    expect(new Set(batchIds).size).toBe(1);
  });
});

describe('listUnmatchedBankTransactions', () => {
  it('queries unmatched AND ambiguous rows, newest first', async () => {
    prismaMock.bankTransaction.findMany.mockResolvedValue([] as any);

    await listUnmatchedBankTransactions();

    expect(prismaMock.bankTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matchStatus: { in: ['unmatched', 'ambiguous'] } },
        orderBy: { transactionDate: 'desc' },
      })
    );
  });
});
