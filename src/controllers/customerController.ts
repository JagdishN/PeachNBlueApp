import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../prisma/client';
import { reissueAllOpenInvoicesForCustomer, reissueInvoice } from '../services/invoiceReissue.service';
import { customerSelectForRole } from '../utils/roleAwareSelect';

// CLAUDE.md "bag policy — RESOLVED": free for every customer, ₹350 only if
// subsequently lost/damaged. Fixed, not admin/staff-entered — same "fixed
// fee, not a free-text amount" treatment as other confirmed charges in this
// codebase.
const BAG_REPLACEMENT_FEE = 350;

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

// Staff + admin — CLAUDE.md "Laundry bag tracking": the bag is free and
// issued once per customer (not per order), physically handed over by
// whoever's at the pickup. Idempotent — marking an already-issued customer
// again is a no-op (doesn't reset bagIssuedAt), matching the "first bag
// free" framing: there is only ever one "issuance" per customer, tracked as
// a single boolean+timestamp; anything after that is a *replacement* (see
// reportBagReplacementHandler below), not a re-issuance.
export const markBagIssuedHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });

  if (!customer) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }

  if (customer.bagIssued) {
    res.status(200).json({ customer });
    return;
  }

  const updated = await prisma.customer.update({
    where: { id: req.params.id },
    data: { bagIssued: true, bagIssuedAt: new Date() },
  });

  res.status(200).json({ customer: updated });
};

// Staff + admin — CLAUDE.md "Laundry bag tracking": logs a lost/damaged
// bag as a distinct ₹350 AdditionalCharge (chargeType: bag_replacement),
// not a garment charge, and NOT a reset of bagIssued/bagIssuedAt — the
// customer already had their one free bag; this row is the record of each
// time it needed replacing. Requires a bag to have actually been issued
// first (can't "lose" a bag that was never handed over). orderId is
// optional — lets staff tie the report to the pickup/delivery they noticed
// it at, but isn't required since a customer might report it separately.
export const reportBagReplacementHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { orderId, description } = req.body;

  const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });

  if (!customer) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }

  if (!customer.bagIssued) {
    res.status(400).json({ error: 'This customer has not been issued a bag yet.' });
    return;
  }

  const charge = await prisma.additionalCharge.create({
    data: {
      customerId: req.params.id,
      orderId: orderId ?? null,
      chargeType: 'bag_replacement',
      amount: BAG_REPLACEMENT_FEE,
      description: description ?? null,
      createdById: req.auth!.userId,
    },
  });

  // CLAUDE.md "Bag-replacement ₹350 charge": if this report is tied to a
  // specific order (orderId given) and that order's invoice hasn't been
  // superseded by delivery/payment yet, reissue it now — invoiceService's
  // generateInvoice picks up this exact charge via its own
  // additionalCharge lookup, so the customer's payment link reflects the
  // ₹350 immediately rather than only on some later unrelated reissue.
  if (orderId) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { internalStatus: true, paymentStatus: true },
    });
    if (order && order.internalStatus !== 'delivered' && order.paymentStatus !== 'paid') {
      await reissueInvoice(orderId);
    }
  }

  res.status(201).json({ charge });
};

// Admin-only — CLAUDE.md "Laundry bag tracking": lets the Customer
// Management screen show how many times a customer's bag has been
// replaced, without pulling full AdditionalCharge rows.
export const listBagReplacementsHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const charges = await prisma.additionalCharge.findMany({
    where: { customerId: req.params.id, chargeType: 'bag_replacement' },
    orderBy: { createdAt: 'desc' },
  });

  res.status(200).json({ charges });
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

// Admin-only — CLAUDE.md "Per-flat discounts — RESOLVED": lets the Customer
// Management screen show who changed this customer's discount and when,
// since discountPercent/discountEnabled otherwise update silently with no
// other record of it (unlike order_amount_revisions, which has always had
// this for order-level amount changes).
export const listDiscountAuditHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const audits = await prisma.customerDiscountAudit.findMany({
    where: { customerId: req.params.id },
    include: { changedBy: { select: { fullName: true, phoneNumber: true } } },
    orderBy: { changedAt: 'desc' },
  });

  res.status(200).json({ audits });
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

  // CLAUDE.md "Per-flat discounts — RESOLVED": who changed the discount and
  // when — same purpose as OrderAmountRevision, since discountPercent is
  // real financial data with no other audit trail otherwise.
  await prisma.customerDiscountAudit.create({
    data: {
      customerId: req.params.id,
      field: 'discountPercent',
      oldValue: String(customer.discountPercent ?? 0),
      newValue: String(discountPercent),
      changedById: req.auth!.userId,
    },
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

  await prisma.customerDiscountAudit.create({
    data: {
      customerId: req.params.id,
      field: 'discountEnabled',
      oldValue: String(customer.discountEnabled),
      newValue: String(discountEnabled),
      changedById: req.auth!.userId,
    },
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
