import crypto from 'crypto';
import prisma from '../prisma/client';
import { toPaise } from '../utils/money';

export interface ImportSummary {
  importBatchId: string;
  totalRows: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  skippedDebits: number;
}

interface ParsedRow {
  utrReference: string;
  amount: number;
  transactionDate: Date;
  direction: 'credit' | 'debit';
  rawDescription: string | null;
}

// Deliberately a small hand-rolled parser, not a new CSV library dependency
// ("do not introduce unnecessary dependencies") — this is a fixed, known
// internal format (exported from the business's own bank statement, columns
// normalized by whoever prepares the file before uploading), not a general-
// purpose CSV ingestion requirement. Expected header (case-insensitive,
// order-independent): utr,amount,date,direction,description.
const parseCsv = (csvText: string): ParsedRow[] => {
  const lines = csvText.trim().split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const utrCol = col('utr');
  const amountCol = col('amount');
  const dateCol = col('date');
  const directionCol = col('direction');
  const descriptionCol = col('description');

  if (utrCol === -1 || amountCol === -1 || dateCol === -1 || directionCol === -1) {
    throw new Error('CSV header must include utr, amount, date, and direction columns.');
  }

  return lines.slice(1).map((line, i) => {
    const cells = line.split(',').map((c) => c.trim());
    const utrReference = cells[utrCol];
    const amount = Number(cells[amountCol]);
    const transactionDate = new Date(cells[dateCol]);
    const direction = cells[directionCol].toLowerCase();

    if (!utrReference) {
      throw new Error(`Row ${i + 2}: missing UTR reference.`);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Row ${i + 2}: invalid amount "${cells[amountCol]}".`);
    }
    if (Number.isNaN(transactionDate.getTime())) {
      throw new Error(`Row ${i + 2}: invalid date "${cells[dateCol]}".`);
    }
    if (direction !== 'credit' && direction !== 'debit') {
      throw new Error(`Row ${i + 2}: direction must be "credit" or "debit", got "${cells[directionCol]}".`);
    }

    return {
      utrReference,
      amount,
      transactionDate,
      direction: direction as 'credit' | 'debit',
      rawDescription: descriptionCol !== -1 ? cells[descriptionCol] ?? null : null,
    };
  });
};

// Payment-safety review section 7, "Bank Reconciliation" — imports a bank
// statement export and attempts to match CREDIT rows against staff-reported
// bank_upi Payment rows, strictly by exact UTR (never by amount alone —
// "do not automatically verify a payment solely because its amount
// matches an invoice"). This only IMPORTS and MATCHES; it does NOT verify a
// Payment itself — that's still the separate, explicit admin action
// (bankUpiService.ts::verifyBankUpiPayment), so a bank-statement match is
// strong supporting evidence for that decision, not a bypass of it.
export const importBankStatementCsv = async (
  csvText: string,
  bankAccountRef: string,
  importedById: string
): Promise<ImportSummary> => {
  const rows = parseCsv(csvText);
  const importBatchId = crypto.randomUUID();

  let matched = 0;
  let ambiguous = 0;
  let unmatched = 0;
  let skippedDebits = 0;

  for (const row of rows) {
    if (row.direction === 'debit') {
      // Debits (refunds, bank charges, etc.) aren't matchable against an
      // incoming customer payment — imported for a complete record, but
      // never considered for matching.
      await prisma.bankTransaction.create({
        data: {
          bankAccountRef,
          utrReference: row.utrReference,
          amountPaise: toPaise(row.amount),
          transactionDate: row.transactionDate,
          direction: row.direction,
          rawDescription: row.rawDescription,
          matchStatus: 'ignored',
          importBatchId,
          importedById,
        },
      });
      skippedDebits += 1;
      continue;
    }

    const candidates = await prisma.payment.findMany({
      where: { paymentSource: 'bank_upi', utrReference: row.utrReference },
    });

    let matchStatus: 'matched' | 'ambiguous' | 'unmatched';
    let matchedPaymentId: string | null = null;

    if (candidates.length === 0) {
      matchStatus = 'unmatched';
      unmatched += 1;
    } else if (candidates.length > 1) {
      // Same UTR used on more than one reported payment — needs a human,
      // never auto-resolved by picking one.
      matchStatus = 'ambiguous';
      ambiguous += 1;
    } else {
      const candidate = candidates[0];
      if (candidate.amountPaise === toPaise(row.amount)) {
        matchStatus = 'matched';
        matchedPaymentId = candidate.id;
        matched += 1;
      } else {
        // UTR matches but the amount doesn't — flagged for review rather
        // than trusted, exactly the case spec section 7 warns against
        // resolving automatically.
        matchStatus = 'ambiguous';
        ambiguous += 1;
      }
    }

    await prisma.bankTransaction.create({
      data: {
        bankAccountRef,
        utrReference: row.utrReference,
        amountPaise: toPaise(row.amount),
        transactionDate: row.transactionDate,
        direction: row.direction,
        rawDescription: row.rawDescription,
        matchStatus,
        matchedPaymentId,
        importBatchId,
        importedById,
      },
    });
  }

  return { importBatchId, totalRows: rows.length, matched, ambiguous, unmatched, skippedDebits };
};

export const listUnmatchedBankTransactions = () =>
  prisma.bankTransaction.findMany({
    where: { matchStatus: { in: ['unmatched', 'ambiguous'] } },
    orderBy: { transactionDate: 'desc' },
  });
