import { serializeBigInts } from '../utils/serialize';

describe('serializeBigInts', () => {
  // The actual production-crashing bug this exists to prevent: JSON.stringify
  // throws outright on a raw BigInt, and several controllers in the
  // outstanding-dues/payment-safety rework returned raw Prisma rows
  // (Payment.amountPaise, BankTransaction.amountPaise,
  // PaymentReconciliationException.collectedPaise, etc.) straight into
  // res.json() — never caught by any mocked-service unit test, since a
  // mock never exercises a real JSON.stringify pass.
  it('converts a top-level bigint to a number', () => {
    expect(serializeBigInts(500n)).toBe(500);
  });

  it('converts a bigint nested inside an object', () => {
    const result = serializeBigInts({ amountPaise: 50000n, label: 'cash' });
    expect(result).toEqual({ amountPaise: 50000, label: 'cash' });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('converts bigints inside an array of objects (a typical findMany result)', () => {
    const rows = [{ id: 'p1', amountPaise: 1000n }, { id: 'p2', amountPaise: 2000n }];
    expect(serializeBigInts(rows)).toEqual([{ id: 'p1', amountPaise: 1000 }, { id: 'p2', amountPaise: 2000 }]);
  });

  it('converts bigints nested several levels deep (e.g. a related record)', () => {
    const row = { id: 'exc-1', excessPaise: 3000n, customer: { id: 'c1', name: 'Test' } };
    expect(serializeBigInts(row)).toEqual({ id: 'exc-1', excessPaise: 3000, customer: { id: 'c1', name: 'Test' } });
  });

  it('leaves a plain Date untouched rather than recursing into it', () => {
    const date = new Date('2026-11-01');
    const result = serializeBigInts({ sentAt: date });
    expect(result.sentAt).toBe(date);
  });

  // Prisma's Decimal (order.finalAmount, invoice.amount, etc.) has its own
  // toJSON() that JSON.stringify already respects correctly — recursing
  // into its internal fields instead would break it.
  it('leaves an object with its own toJSON (e.g. a Decimal-like value) untouched', () => {
    const decimalLike = { d: [1, 2], e: 0, s: 1, toJSON: () => '12.00' };
    const result = serializeBigInts({ amount: decimalLike });
    expect(result.amount).toBe(decimalLike);
    expect(JSON.stringify(result)).toBe('{"amount":"12.00"}');
  });

  it('leaves null and primitive values untouched', () => {
    expect(serializeBigInts(null)).toBeNull();
    expect(serializeBigInts('text')).toBe('text');
    expect(serializeBigInts(42)).toBe(42);
    expect(serializeBigInts(true)).toBe(true);
  });
});
