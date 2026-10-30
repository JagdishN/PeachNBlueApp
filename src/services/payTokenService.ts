import crypto from 'crypto';
import prisma from '../prisma/client';

// Payment-safety review section 5: "Use a cryptographically secure,
// non-enumerable token." 32 random bytes (256 bits) as hex — not derived
// from the invoice id/number (which ARE somewhat guessable/sequential-
// looking), and far too large to brute-force.
const generateToken = (): string => crypto.randomBytes(32).toString('hex');

// Assigns a token once per invoice and keeps it stable thereafter —
// deliberately NOT rotated on every reissue/link-replacement, because the
// redirect endpoint (payController.ts) always re-resolves the invoice's
// LIVE state at click time rather than caching anything at generation
// time, so a stable token stays correct across reissues, partial
// payments, and link replacements without needing the old WhatsApp
// message's link invalidated. Call this once, right after the invoice
// row exists (invoiceService.ts::generateInvoice).
export const ensurePaymentToken = async (invoiceId: string): Promise<string> => {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }
  if (invoice.paymentToken) {
    return invoice.paymentToken;
  }

  const token = generateToken();
  await prisma.invoice.update({ where: { id: invoiceId }, data: { paymentToken: token } });
  return token;
};

// Revokes a token outright (spec: "ensure tokens can be revoked") — e.g. if
// one is ever suspected leaked/shared beyond the intended 3 numbers. Not
// currently wired to any UI action; exposed for a future admin control.
export const revokePaymentToken = async (invoiceId: string): Promise<void> => {
  await prisma.invoice.update({ where: { id: invoiceId }, data: { paymentToken: null } });
};
