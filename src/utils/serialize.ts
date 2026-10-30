// Real bug found while finishing the outstanding-dues rework's mobile
// client (not caught by any test — a mocked service result never
// exercises a real JSON.stringify pass the way a live Prisma row does):
// several controllers across both payment-safety-rework sessions
// returned raw Prisma rows containing BigInt fields (Payment.amountPaise/
// allocatedPaise, BankTransaction.amountPaise, PaymentReconciliationException
// .collectedPaise/allocatedPaise/excessPaise, PaymentReminderLog
// .outstandingAtSendPaise) straight into `res.json()`. Express's res.json
// calls JSON.stringify under the hood, which THROWS outright on a BigInt
// ("Do not know how to serialize a BigInt") — every one of those response
// paths would have crashed on the very first real request against a real
// database, despite passing every existing mocked-service unit test.
//
// Converting to Number is safe here specifically because every BigInt in
// this codebase is a paise amount (see src/utils/money.ts) — realistic
// laundry-order amounts are nowhere near Number.MAX_SAFE_INTEGER (2^53).
export const serializeBigInts = <T>(value: T): T => {
  if (typeof value === 'bigint') {
    return Number(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeBigInts(item)) as unknown as T;
  }
  if (value instanceof Date) {
    return value;
  }
  // Prisma's Decimal (order.finalAmount, invoice.amount, etc.) implements
  // its own toJSON() that JSON.stringify already respects correctly —
  // recursing into its internal fields (d/e/s) here instead would destroy
  // that. Leave anything with a toJSON of its own untouched.
  if (value !== null && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return value;
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = serializeBigInts(val);
    }
    return result as unknown as T;
  }
  return value;
};
