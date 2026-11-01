import { PrismaClient } from '@prisma/client';

// Real bug found and fixed (2026-11-01): a staff cash payment that turned
// out to be an overpayment (recordVerifiedPayment -> recordOverpaymentException)
// failed in production with Prisma error P2028 ("Transaction not found...
// refers to an old closed transaction"), rolling back the ENTIRE
// transaction — including the Payment row that had already been created
// earlier in the same transaction. Confirmed via the real Render stack
// trace (not guessed): the failing query was PaymentReconciliationException,
// the LAST write recordVerifiedPayment's transaction makes, after an invoice
// lock, several getInvoicePaymentSummary reads (each itself 2-3 queries),
// the Payment create, a PaymentAllocation create, and recalculateInvoiceStatus
// — a dozen-plus sequential round trips to Postgres THROUGH Supabase's
// connection pooler (DATABASE_URL uses pgbouncer=true), easily exceeding
// Prisma's undocumented-but-real default interactive-transaction window
// (maxWait: 2s to acquire, timeout: 5s to complete) under real network
// latency, even though every individual query is fast and correct on its
// own — this is why mocked-Prisma unit tests could never catch it (a mock
// has no transaction timing at all).
//
// Every prisma.$transaction call in this codebase (recordPayment,
// recordOnlinePayment, invoice adjustments, bank-UPI verification, etc.)
// shares this same unconfigured default and the same risk as the ledger
// grows more steps — fixed once, globally, here, rather than passing
// {timeout, maxWait} at each of the ~15 call sites individually. Values
// chosen generously (not just "enough for today's longest path") since the
// cost of a slightly-too-long transaction occasionally holding a row lock a
// few seconds longer is far smaller than the cost of silently rolling back
// an already-collected real cash payment.
const prisma = new PrismaClient({
  transactionOptions: {
    maxWait: 10_000,
    timeout: 20_000,
  },
});
export default prisma;
