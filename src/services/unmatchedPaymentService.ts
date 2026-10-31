import { Prisma } from '@prisma/client';
import prisma from '../prisma/client';

// Webhook historical-link resolution fix (2026-10-31) — a durable queue for
// a verified Razorpay receipt that webhookController.ts::resolveInvoiceForLink
// could not tie to any invoice, via either the active-link lookup or the
// payment_link_history fallback. "Do not discard a verified receipt if the
// invoice cannot be resolved" — this is that persistence, not a console log.
// Should be unreachable in normal operation (Peach & Blue controls every
// link it ever creates), so a non-empty queue here always deserves a real
// look, not routine triage.

export interface RecordUnmatchedPaymentInput {
  razorpayPaymentId: string;
  razorpayPaymentLinkId: string | null;
  amountPaise: bigint;
  rawPayload: unknown;
}

// Idempotent on razorpayPaymentId (DB-unique) — a redelivered webhook for a
// payment that's already queued here must not create a second row. Any
// error OTHER than the duplicate-key case is rethrown deliberately: this
// must NOT be swallowed into a "logged but acknowledged" 200, because that
// would violate "do not acknowledge a webhook as successfully processed if
// a recoverable database failure prevented durable recording" — letting it
// throw lets express-async-errors turn this into a non-200 response, so
// Razorpay's own retry policy gets another attempt later.
export const recordUnmatchedPayment = async (input: RecordUnmatchedPaymentInput): Promise<void> => {
  try {
    await prisma.unmatchedProviderPayment.create({
      data: {
        razorpayPaymentId: input.razorpayPaymentId,
        razorpayPaymentLinkId: input.razorpayPaymentLinkId,
        amountPaise: input.amountPaise,
        rawPayload: input.rawPayload as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Same unresolved payment redelivered — already queued, benign no-op.
      return;
    }
    throw err;
  }
};

// Admin visibility (spec: "make the exception visible through the existing
// admin reconciliation workflow") — same shape/convention as
// reconciliationController.ts's listReconciliationExceptionsHandler.
export const listUnmatchedPayments = (status: string) =>
  prisma.unmatchedProviderPayment.findMany({
    where: status === 'all' ? {} : { status },
    orderBy: { createdAt: 'desc' },
  });

export const resolveUnmatchedPayment = async (id: string, resolution: string, notes: string | undefined, resolvedById: string) => {
  const existing = await prisma.unmatchedProviderPayment.findUnique({ where: { id } });
  if (!existing) {
    return null;
  }

  return prisma.unmatchedProviderPayment.update({
    where: { id },
    data: {
      status: resolution,
      resolutionNotes: notes ?? existing.resolutionNotes,
      resolvedById,
      resolvedAt: new Date(),
    },
  });
};
