import prisma from '../prisma/client';
import { sendWhatsAppTemplate, formatMsg91Error } from '../lib/msg91Client';

// Payment collection / customer advances rework, Phase 6 — a minimal
// durable retry mechanism for a WhatsApp send that failed on the first
// attempt. Sized to what the spec actually asks for ("do not roll back a
// successfully recorded payment if WhatsApp delivery fails... use a
// durable notification outbox or equivalent retry mechanism") rather than
// a general-purpose message queue. CommunicationLog (status: sent |
// failed) already records the OUTCOME of every send attempt, customer-
// facing or admin — this is additive, a row here exists ONLY for a failed
// send that still needs retrying, and is removed once it succeeds or is
// abandoned. notificationService.ts calls enqueueFailedSend for every
// per-recipient failure, so every existing call site (pickup confirmation,
// payment receipt, reminders, admin notifications, etc.) gets this
// durability for free — no changes needed at any of those call sites.

export interface EnqueueFailedSendInput {
  customerId: string | null;
  recipientPhoneNumber: string;
  fromNumber: string;
  templateName: string;
  templateLanguage: string;
  bodyVariables: string[];
  buttonUrlParam?: string | null;
  headerMediaUrl?: string | null;
  headerType?: string | null;
}

export const enqueueFailedSend = async (input: EnqueueFailedSendInput): Promise<void> => {
  await prisma.notificationOutbox.create({
    data: {
      customerId: input.customerId,
      recipientPhoneNumber: input.recipientPhoneNumber,
      fromNumber: input.fromNumber,
      templateName: input.templateName,
      templateLanguage: input.templateLanguage,
      bodyVariables: input.bodyVariables,
      buttonUrlParam: input.buttonUrlParam ?? null,
      headerMediaUrl: input.headerMediaUrl ?? null,
      headerType: input.headerType ?? null,
      status: 'pending',
    },
  });
};

// Backoff schedule for repeated failures — each attempt pushes the next
// retry further out rather than hammering MSG91/Meta at a fixed interval.
const BACKOFF_MINUTES = [5, 15, 60, 240, 1440];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

export interface ProcessOutboxResult {
  sent: number;
  stillPending: number;
  abandoned: number;
}

// Not wired to any scheduler yet — same "exposed for a future cron/admin-
// triggered endpoint, not automatic" precedent as
// paymentLinkLifecycle.ts::recoverStuckTransitions. Processes rows whose
// nextRetryAt has passed; a row is DELETED on success (nothing further to
// track — the eventual CommunicationLog write for the retry happens the
// normal way, via sendWhatsAppTemplate's caller semantics, not duplicated
// here) and marked 'abandoned' (kept, not deleted, for visibility) after
// MAX_ATTEMPTS failures.
export const processNotificationOutbox = async (batchSize = 50): Promise<ProcessOutboxResult> => {
  const due = await prisma.notificationOutbox.findMany({
    where: { status: 'pending', nextRetryAt: { lte: new Date() } },
    take: batchSize,
    orderBy: { nextRetryAt: 'asc' },
  });

  let sent = 0;
  let abandoned = 0;

  for (const row of due) {
    try {
      await sendWhatsAppTemplate({
        toPhoneNumber: row.recipientPhoneNumber,
        fromNumber: row.fromNumber,
        templateName: row.templateName,
        language: row.templateLanguage,
        bodyVariables: row.bodyVariables,
        buttonUrlParam: row.buttonUrlParam ?? undefined,
        headerMediaUrl: row.headerMediaUrl ?? undefined,
        headerType: (row.headerType as 'document' | 'image' | undefined) ?? undefined,
      });
      await prisma.notificationOutbox.delete({ where: { id: row.id } });
      sent += 1;
    } catch (err) {
      const attempts = row.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await prisma.notificationOutbox.update({
          where: { id: row.id },
          data: { status: 'abandoned', attempts, lastError: formatMsg91Error(err) },
        });
        abandoned += 1;
      } else {
        const delayMinutes = BACKOFF_MINUTES[attempts - 1] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1];
        await prisma.notificationOutbox.update({
          where: { id: row.id },
          data: {
            attempts,
            lastError: formatMsg91Error(err),
            nextRetryAt: new Date(Date.now() + delayMinutes * 60 * 1000),
          },
        });
      }
    }
  }

  const stillPending = await prisma.notificationOutbox.count({ where: { status: 'pending' } });
  return { sent, stillPending, abandoned };
};
