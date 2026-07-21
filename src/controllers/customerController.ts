import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../prisma/client';
import { reissueAllOpenInvoicesForCustomer } from '../services/invoiceReissue.service';
import { customerSelectForRole } from '../utils/roleAwareSelect';

// Staff + admin (unlike the admin-only discount/billing endpoints below) —
// CLAUDE.md "Customer creation — real gap": staff need to create/reuse a
// customer record inline at the point of pickup, not through an admin-only
// flow. Idempotent: looked up by the same (phoneNumber, branchId,
// locationLabel) unique constraint orderService.ts's createOrder already
// upserts on — calling this twice for the same flat returns the same
// record rather than erroring or duplicating it. Uses customerSelectForRole
// (primary defense, not just the staffFieldFilter safety net) since a
// staff-role caller reaches this endpoint directly.
export const createCustomerHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { fullName, phoneNumber, locationLabel } = req.body;

  if (!fullName || !phoneNumber || !locationLabel) {
    res.status(400).json({ error: 'fullName, phoneNumber, and locationLabel are required' });
    return;
  }

  // Staff are locked to their own branch — they can't create a customer
  // record in a branch they don't work at. Admin must supply branchId
  // explicitly, falling back to their own branchId if they're branch-scoped
  // (an unscoped admin has no implicit branch to fall back to).
  const branchId = req.auth!.role === 'staff' ? req.auth!.branchId : req.body.branchId ?? req.auth!.branchId;

  if (!branchId) {
    res.status(400).json({ error: 'branchId is required' });
    return;
  }

  const customer = await prisma.customer.upsert({
    where: {
      phoneNumber_branchId_locationLabel: { phoneNumber, branchId, locationLabel },
    },
    update: { fullName },
    create: { fullName, phoneNumber, branchId, locationLabel },
    select: customerSelectForRole(req.auth!.role),
  });

  res.status(200).json({ customer });
};

// Staff + admin — backs the mobile New Order Entry screen's phone-lookup
// step. Branch-scoped the same way listCustomersHandler is below: a
// branch-scoped user's own branchId always wins; an unscoped admin may pass
// ?branchId= to narrow, or omit it to search every branch.
export const searchCustomersHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { phone, branchId } = req.query;

  if (typeof phone !== 'string' || !phone) {
    res.status(400).json({ error: 'phone query parameter is required' });
    return;
  }

  const effectiveBranchId = req.auth!.branchId ?? (typeof branchId === 'string' ? branchId : undefined);

  const customers = await prisma.customer.findMany({
    where: {
      phoneNumber: phone,
      ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
    },
    select: customerSelectForRole(req.auth!.role),
    orderBy: { locationLabel: 'asc' },
  });

  res.status(200).json({ customers });
};

// Admin-only — new for the Customer Management screen (CLAUDE.md "Known
// gaps": billingMode/discountEnabled/discountPercent were only reachable
// via raw API calls with no listing endpoint to build a UI against at all).
// Not role-scoped via customerSelectForRole (that helper is for
// staff-reachable, order-derived customer data) — this whole route is
// admin-only by route gating, so the full row is fine to return, same as
// updateDiscountHandler/updateBillingModeHandler above already do.
export const listCustomersHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { branchId } = req.query;

  // Branch-scoped admin can only see their own branch — auth's branchId
  // always wins over any query param, mirroring branchController.ts's
  // listBranchesHandler. An unscoped admin (branchId === null) may pass an
  // optional branchId query param to filter, or omit it to see all.
  const effectiveBranchId = req.auth!.branchId ?? (typeof branchId === 'string' ? branchId : undefined);

  const customers = await prisma.customer.findMany({
    where: effectiveBranchId ? { branchId: effectiveBranchId } : undefined,
    include: { branch: { select: { branchName: true } } },
    orderBy: [{ branchId: 'asc' }, { locationLabel: 'asc' }],
  });

  res.status(200).json({ customers });
};

// Admin-only, deliberately separate from order creation's customer
// upsert (src/services/orderService.ts) — staff must never be able to
// reach this through the customer flow they already use.
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

  // CLAUDE.md "Per-flat discounts — RESOLVED": a discount change reissues
  // the invoice for every one of this customer's orders that isn't yet
  // delivered/paid. Awaited (not fire-and-forget) — this is a low-frequency
  // admin action, and the admin should see a reissue failure rather than
  // have it silently swallowed.
  await reissueAllOpenInvoicesForCustomer(updated.id);

  res.status(200).json({ customer: updated });
};

// Admin-only, separate from discountPercent (CLAUDE.md "Monthly billing +
// discount: now live"): this toggles whether the stored percentage actually
// applies, without clearing it. Reissues open invoices either way — turning
// the discount on or off changes the payable amount on any invoice already
// out, same as an update to the percentage itself does.
export const updateDiscountEnabledHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { discountEnabled } = req.body;

  if (typeof discountEnabled !== 'boolean') {
    res.status(400).json({ error: 'discountEnabled must be a boolean' });
    return;
  }

  const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });

  if (!customer) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }

  const updated = await prisma.customer.update({
    where: { id: req.params.id },
    data: { discountEnabled },
  });

  await reissueAllOpenInvoicesForCustomer(updated.id);

  res.status(200).json({ customer: updated });
};

// Admin-only write; unlike discountPercent/discountEnabled, billingMode is
// readable by staff (CLAUDE.md: they need to know at delivery whether to
// collect payment now or let it post to the ledger) — so this endpoint only
// gates the WRITE, via requireRole('admin') on the route, not the field's
// visibility in reads. No invoice reissue here: billingMode doesn't change
// an order's payable amount, unlike the discount fields above.
export const updateBillingModeHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { billingMode } = req.body;

  if (billingMode !== 'daily' && billingMode !== 'monthly_billing') {
    res.status(400).json({ error: "billingMode must be 'daily' or 'monthly_billing'" });
    return;
  }

  const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });

  if (!customer) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }

  const updated = await prisma.customer.update({
    where: { id: req.params.id },
    data: { billingMode },
  });

  res.status(200).json({ customer: updated });
};
