import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../prisma/client';

// Admin-only, deliberately separate from order creation's customer
// upsert (src/services/orderService.ts) — staff must never be able to
// reach this through the customer flow they already use.
//
// TODO(invoice reissue): once src/services/invoiceReissue.service.ts
// exists, this handler should call it for every one of this customer's
// orders that isn't yet delivered/paid — see CLAUDE.md "Per-flat
// discounts — RESOLVED".
export const updateDiscountHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { discountPercent } = req.body;

  if (typeof discountPercent !== 'number' || Number.isNaN(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    res.status(400).json({ error: 'discountPercent must be a number between 0 and 100' });
    return;
  }

  const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });

  if (!customer) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }

  const updated = await prisma.customer.update({
    where: { id: req.params.id },
    data: { discountPercent },
  });

  res.status(200).json({ customer: updated });
};
