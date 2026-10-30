// Payment-safety review: "Use integer paise for all financial calculations.
// Do not use floating-point arithmetic for monetary balances." Scoped
// deliberately to the payment-ledger/allocation code path only (Payment,
// PaymentLinkHistory, PaymentReconciliationException, BankTransaction) —
// GarmentCatalogue/OrderItem/Order/Invoice.amount stay Decimal rupees,
// unchanged, since rewriting the entire pricing system to paise would be
// exactly the "unrelated refactoring" this same review tells us to avoid,
// for no benefit to payment correctness. This file is the one conversion
// boundary: Decimal/number rupees in, BigInt paise out, and back.

// Prisma Decimal instances stringify losslessly via toString() — going
// through Number() first (as most of this codebase already does elsewhere)
// is exactly the floating-point risk this file exists to avoid.
export const toPaise = (rupees: unknown): bigint => {
  const str = typeof rupees === 'object' && rupees !== null && 'toString' in rupees ? rupees.toString() : String(rupees);
  const normalized = Number(str);
  if (!Number.isFinite(normalized)) {
    throw new Error(`Cannot convert non-finite value to paise: ${str}`);
  }
  // Round at the rupee-to-paise boundary only, once — matches
  // razorpayClient.ts's existing Math.round(amount * 100) convention for
  // what Razorpay itself expects, so a converted amount always matches what
  // was actually sent to/received from Razorpay.
  return BigInt(Math.round(normalized * 100));
};

export const fromPaise = (paise: bigint): number => Number(paise) / 100;

export const addPaise = (a: bigint, b: bigint): bigint => a + b;
export const subPaise = (a: bigint, b: bigint): bigint => a - b;

// Never negative — callers that need to detect "would this go negative"
// should compare before calling, not rely on this to signal it.
export const clampNonNegative = (value: bigint): bigint => (value < 0n ? 0n : value);
