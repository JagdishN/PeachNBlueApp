import prisma from '../prisma/client';
import { createPaymentLink, cancelPaymentLink } from '../lib/razorpayClient';
import { getInvoicePaymentSummary, paiseToDisplayAmount } from './paymentLedgerService';
import { toPaise } from '../utils/money';

export type LinkTransitionReason =
  | 'cash_full'
  | 'cash_partial'
  | 'bank_upi_full'
  | 'bank_upi_partial'
  | 'reissue'
  // Admin Payment Override — closing a partially-paid invoice's remaining
  // balance via a waiver. Reuses this same state machine unchanged: if an
  // active link exists it's cancelled (now that outstanding is 0 after the
  // waiver, the "fully settled, no replacement" branch below fires and no
  // new link is created); 'adjustment_reversal' is the mirror case for
  // undoing that — outstanding goes back above 0, so this function's
  // existing "creating_new_link" branch issues a fresh real link rather
  // than resurrecting the old (already-cancelled) one, per the spec's
  // "any new Razorpay collection link must be created through the
  // centralized payment-link lifecycle, not by directly reusing an
  // outdated link."
  | 'admin_waiver'
  | 'adjustment_reversal';

export interface LifecycleResult {
  // True only when the lifecycle fully completed (old link resolved one way
  // or another, and either a correct replacement link exists or none is
  // needed because the invoice is fully settled). False means a
  // reconciliation exception was opened and a human needs to look at it —
  // callers must NOT treat false as a hard failure of the payment itself
  // (the Payment row this was triggered by is already durably recorded
  // before this function is ever called — see orderService.ts/webhook
  // callers).
  completed: boolean;
  newPaymentLinkId: string | null;
  newPaymentLinkUrl: string | null;
}

// Centralized payment-link lifecycle manager (payment-safety review section
// 4.3/4.4/10: "use ONE centralized link lifecycle manager... prevent
// competing cancellation/replacement logic in different services"). Replaces
// the ad-hoc cancelPaymentLink call that used to live directly inside
// invoiceService.ts::generateInvoice for the reissue case — that call site
// now delegates here too (see invoiceService.ts), so cash/bank_upi
// collections and invoice reissues/revisions all go through the same state
// machine instead of two parallel implementations.
//
// MUST be called AFTER the triggering Payment row has already been
// durably recorded (paymentLedgerService.recordVerifiedPayment, in its own
// transaction) — this function deliberately never opens a DB transaction
// that spans a Razorpay network call (payment-safety review: "never hold a
// database transaction open while waiting for a Razorpay network API
// call"), so it writes its own progress to PaymentLinkTransition as
// discrete, already-atomic single-row statements between network calls,
// not inside one wrapping transaction.
export const retireOrReplaceLink = async (
  invoiceId: string,
  reason: LinkTransitionReason,
  triggeredById: string | null
): Promise<LifecycleResult> => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { order: { include: { customer: true } } },
  });
  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }

  const oldLinkId = invoice.razorpayPaymentLinkId;

  const transition = await prisma.paymentLinkTransition.create({
    data: { invoiceId, reason, oldPaymentLinkId: oldLinkId, triggeredById, status: 'pending' },
  });

  if (oldLinkId) {
    await prisma.paymentLinkTransition.update({ where: { id: transition.id }, data: { status: 'cancelling_old_link' } });

    // Network call — deliberately outside any open transaction.
    const cancelResult = await cancelPaymentLink(oldLinkId);

    await prisma.paymentLinkHistory.create({
      data: {
        invoiceId,
        razorpayPaymentLinkId: oldLinkId,
        paymentLinkUrl: invoice.paymentLinkUrl ?? '',
        amountPaise: toPaise(invoice.amount ?? 0),
        finalStatus: cancelResult.success ? 'cancelled' : 'cancel_uncertain',
        retiredReason: reason,
        retiredAt: new Date(),
      },
    });

    if (!cancelResult.success) {
      // 4.3: "Do not create the replacement link while the previous link
      // remains in an unresolved payable state." The already-collected
      // payment that triggered this stays recorded (it was written before
      // this function was ever called) — only the LINK side is left
      // unresolved, flagged for a human to check directly in the Razorpay
      // dashboard before anything else touches this invoice's link.
      await prisma.paymentLinkTransition.update({
        where: { id: transition.id },
        data: { status: 'failed_needs_review', errorDetail: cancelResult.error ?? 'Cancellation uncertain' },
      });

      const summary = await getInvoicePaymentSummary(prisma, invoiceId);
      await prisma.paymentReconciliationException.create({
        data: {
          invoiceId,
          customerId: invoice.order.customerId,
          exceptionType: 'cancellation_uncertain',
          collectedPaise: summary.collectedPaise,
          allocatedPaise: summary.allocatedPaise,
          excessPaise: 0n,
          relatedPaymentIds: [],
          status: 'open',
          resolutionNotes: `Old link ${oldLinkId} cancel result uncertain (${cancelResult.error ?? 'unknown'}). Verify directly in the Razorpay dashboard before relying on this invoice's payment-link state.`,
        },
      });

      return { completed: false, newPaymentLinkId: null, newPaymentLinkUrl: null };
    }

    // Old link genuinely cancelled — clear it so nothing downstream treats
    // it as still active while we decide on a replacement below.
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { razorpayPaymentLinkId: null, paymentLinkUrl: null, paymentLinkStatus: 'cancelled' },
    });
  }

  await prisma.paymentLinkTransition.update({ where: { id: transition.id }, data: { status: 'creating_new_link' } });

  const summary = await getInvoicePaymentSummary(prisma, invoiceId);

  if (summary.outstandingPaise <= 0n) {
    // Fully settled — no replacement link needed. The controlled payment
    // URL (/pay/:token) will show a "paid" status page rather than a dead
    // link, since it re-resolves the invoice's live state on every visit
    // rather than caching this moment.
    await prisma.invoice.update({ where: { id: invoiceId }, data: { paymentLinkStatus: 'paid' } });
    await prisma.paymentLinkTransition.update({ where: { id: transition.id }, data: { status: 'completed' } });
    return { completed: true, newPaymentLinkId: null, newPaymentLinkUrl: null };
  }

  const remainingAmount = paiseToDisplayAmount(summary.outstandingPaise);
  const newLinkResult = await createPaymentLink({
    amount: remainingAmount,
    orderNumber: invoice.order.orderNumber,
    orderId: invoice.orderId,
    customerName: invoice.order.customer.fullName,
    customerPhone: invoice.order.customer.phoneNumber,
  });

  // Real bug fixed (2026-11-01): createPaymentLink used to throw straight
  // through this function on any real Razorpay failure — by this point the
  // triggering Payment (the cash/bank_upi collection that called us) is
  // ALREADY durably committed in its own transaction, so that throw never
  // undid the payment, it just turned a successful payment into a bare 500
  // for staff. No invoice update needed here: the invoice was already left
  // in a correct, consistent "no active link" state by the cancel step
  // above (or never had one, if oldLinkId was null) — there's nothing stale
  // to clear. Matches this function's own documented contract: a failure
  // here is reported the same way a failed cancel already is — completed:
  // false, a flagged PaymentLinkTransition, never a thrown exception.
  if (!newLinkResult.success || !newLinkResult.link) {
    await prisma.paymentLinkTransition.update({
      where: { id: transition.id },
      data: {
        status: 'failed_needs_review',
        errorDetail: newLinkResult.error ?? 'Payment link creation failed',
      },
    });

    // Payment-safety corrections (2026-11-01) — this branch is the one a
    // cash/bank_upi payment leaving a remaining balance actually exercises,
    // and until now it had no Admin-visible surface at all (only the "old
    // link cancel failed" branch above creates a reconciliation exception).
    // Own, separate try/catch: a failure persisting THIS record must never
    // itself become a new way to fail the caller's real operation (e.g. the
    // cash payment that triggered this call, already durably committed
    // before retireOrReplaceLink is ever reached).
    try {
      await prisma.paymentReconciliationException.create({
        data: {
          invoiceId,
          customerId: invoice.order.customerId,
          exceptionType: 'link_creation_failed',
          collectedPaise: 0n,
          allocatedPaise: 0n,
          excessPaise: 0n,
          relatedPaymentIds: [],
          status: 'open',
          resolutionNotes: `Replacement payment link creation failed for invoice ${invoiceId} (reason: ${reason}): ${newLinkResult.error ?? 'unknown error'}. Use "Resend Link" once the underlying issue is resolved.`,
        },
      });
    } catch (exceptionErr) {
      console.error(
        `[paymentLinkLifecycle] Failed to persist link_creation_failed exception for invoice ${invoiceId}, transition ${transition.id}:`,
        exceptionErr
      );
    }

    return { completed: false, newPaymentLinkId: null, newPaymentLinkUrl: null };
  }

  const newLink = newLinkResult.link;

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { razorpayPaymentLinkId: newLink.id, paymentLinkUrl: newLink.shortUrl, paymentLinkStatus: 'created' },
  });
  await prisma.paymentLinkTransition.update({
    where: { id: transition.id },
    data: { status: 'completed', newPaymentLinkId: newLink.id },
  });

  return { completed: true, newPaymentLinkId: newLink.id, newPaymentLinkUrl: newLink.shortUrl };
};

// Recovery for a process crash mid-transition (payment-safety review 4.3:
// "use a durable retry/recovery process for incomplete transitions" / 14,
// Recovery test #28). No cron/scheduler infrastructure exists anywhere else
// in this app (same gap as the not-yet-built monthly-statement job) — this
// is exposed for a future scheduled job or an admin-triggered endpoint to
// call periodically, not wired to anything automatic yet. A transition
// that's been stuck in a non-terminal state for longer than staleMinutes is
// re-run from scratch via retireOrReplaceLink (idempotent: re-reads the
// invoice's CURRENT razorpayPaymentLinkId rather than trusting the stuck
// row's stale oldPaymentLinkId, so a crash after the old link was already
// cancelled won't try to cancel it again).
// Payment-safety corrections (2026-11-01) — a transition retried every 10
// minutes with no upper bound could loop silently forever against a
// persistent Razorpay outage, never reaching failed_needs_review (and so
// never getting an Admin-visible exception) because it never completes a
// clean attempt to report failure from. Anything still non-terminal past
// this many minutes stops being silently retried and is escalated instead.
const MAX_STUCK_MINUTES_BEFORE_ESCALATION = 120;

export const recoverStuckTransitions = async (staleMinutes = 15): Promise<{ recovered: number; stillStuck: number }> => {
  const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000);
  const escalateBefore = new Date(Date.now() - MAX_STUCK_MINUTES_BEFORE_ESCALATION * 60 * 1000);
  const stuck = await prisma.paymentLinkTransition.findMany({
    where: { status: { in: ['pending', 'cancelling_old_link', 'creating_new_link'] }, updatedAt: { lt: staleBefore } },
  });

  let recovered = 0;
  let stillStuck = 0;

  for (const row of stuck) {
    // Outstanding-dues rework: PaymentLinkTransition is now polymorphic
    // (invoiceId OR paymentRequestId) — a PaymentRequest-sourced
    // transition's own recovery path is added alongside the rest of that
    // feature (Phase 3), not here. Skipping rather than crashing the whole
    // batch keeps invoice-based recovery working in the meantime.
    if (!row.invoiceId) {
      continue;
    }

    if (row.createdAt < escalateBefore) {
      // Bounded retries: stop silently re-attempting a transition that's
      // been non-terminal for over 2 hours — escalate it explicitly rather
      // than let it loop every 10 minutes indefinitely with no human ever
      // being told.
      try {
        await prisma.paymentLinkTransition.update({
          where: { id: row.id },
          data: { status: 'failed_needs_review', errorDetail: `Stuck in '${row.status}' for over ${MAX_STUCK_MINUTES_BEFORE_ESCALATION} minutes — escalated without further automatic retries.` },
        });
        await prisma.paymentReconciliationException.create({
          data: {
            invoiceId: row.invoiceId,
            customerId: (await prisma.invoice.findUnique({ where: { id: row.invoiceId }, select: { order: { select: { customerId: true } } } }))?.order.customerId ?? '',
            exceptionType: 'link_creation_failed',
            collectedPaise: 0n,
            allocatedPaise: 0n,
            excessPaise: 0n,
            relatedPaymentIds: [],
            status: 'open',
            resolutionNotes: `Payment-link transition ${row.id} (reason: ${row.reason}) has been stuck in '${row.status}' for over ${MAX_STUCK_MINUTES_BEFORE_ESCALATION} minutes and was escalated instead of retried further. Check Razorpay directly before using "Resend Link".`,
          },
        });
      } catch (escalationErr) {
        console.error(`[paymentLinkLifecycle] Failed to escalate long-stuck transition ${row.id}:`, escalationErr);
      }
      stillStuck += 1;
      continue;
    }

    try {
      await retireOrReplaceLink(row.invoiceId, row.reason as LinkTransitionReason, row.triggeredById);
      recovered += 1;
    } catch (err) {
      console.error(`[paymentLinkLifecycle] recovery failed for transition ${row.id}:`, err);
      await prisma.paymentLinkTransition.update({
        where: { id: row.id },
        data: { status: 'failed_needs_review', errorDetail: err instanceof Error ? err.message : String(err) },
      });
      stillStuck += 1;
    }
  }

  return { recovered, stillStuck };
};
