import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import prisma from '../prisma/client';

export const getCurrentUser = async (req: Request, res: Response): Promise<void> => {
  const auth = (req as any).auth;

  if (!auth) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }

  res.status(200).json({ user: auth });
};

const USER_LIST_SELECT = {
  id: true,
  fullName: true,
  phoneNumber: true,
  role: true,
  branchId: true,
  isActive: true,
  createdAt: true,
} as const;

// Admin-only — CLAUDE.md "Staff/Admin account management": this route used
// to alias getCurrentUser (a copy-paste bug — it returned the requester's
// own token payload regardless of the admin-only gate, not an actual user
// list). Branch-scoped the same way listBranchesHandler/listCustomersHandler
// are: a branch-scoped admin's own branchId always wins over any query
// param; an unscoped admin may pass ?branchId= to narrow, or omit it to see
// every branch.
export const listUsersHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { branchId } = req.query;
  const effectiveBranchId = req.auth!.branchId ?? (typeof branchId === 'string' ? branchId : undefined);

  // deleteUserHandler below now hard-deletes where it can — isActive: false
  // only remains on a row that still has order/payment history and couldn't
  // be removed. Those shouldn't clutter the Staff & Admin Accounts screen
  // (client ask), and isActive already blocks their login regardless.
  const users = await prisma.user.findMany({
    where: { isActive: true, ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}) },
    select: USER_LIST_SELECT,
    orderBy: [{ branchId: 'asc' }, { fullName: 'asc' }],
  });

  res.status(200).json({ users });
};

// Admin-only — creates a staff or admin account record. No password field:
// auth is OTP-only (CLAUDE.md "Security baseline"), so this just creates the
// row that lets the phone number log in, matching how the two real admin
// accounts and the internal test account were created (direct DB seeding,
// per CLAUDE.md "Admin accounts") — this is the first in-app path for it.
export const createUserHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { fullName, phoneNumber, role, branchId } = req.body;

  if (!fullName || !phoneNumber || (role !== 'staff' && role !== 'admin')) {
    res.status(400).json({ error: "fullName, phoneNumber, and role ('staff' or 'admin') are required" });
    return;
  }

  // Staff must be scoped to a branch (CLAUDE.md "Roles"). Admin may be
  // branch-scoped (a branch manager) or unscoped (branchId null) — both
  // valid, per the existing admin model.
  if (role === 'staff' && !branchId) {
    res.status(400).json({ error: 'branchId is required for a staff account' });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { phoneNumber } });
  if (existing) {
    res.status(409).json({ error: 'A user with this phone number already exists' });
    return;
  }

  const user = await prisma.user.create({
    data: { fullName, phoneNumber, role, branchId: branchId ?? null },
    select: USER_LIST_SELECT,
  });

  res.status(201).json({ user });
};

// Admin-only — edits an existing staff/admin account. Same phone-number
// uniqueness rule as createUserHandler above (a phone number belongs to
// exactly one User row, regardless of role) — checked here too, excluding
// the row being edited, so changing a phone number to one already used by a
// DIFFERENT account (staff or admin) is rejected the same way a duplicate
// create is.
export const updateUserHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { fullName, phoneNumber, role, branchId } = req.body;

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (role !== undefined && role !== 'staff' && role !== 'admin') {
    res.status(400).json({ error: "role must be 'staff' or 'admin'" });
    return;
  }

  const resolvedRole = role ?? existing.role;
  const resolvedBranchId = branchId !== undefined ? branchId : existing.branchId;

  if (resolvedRole === 'staff' && !resolvedBranchId) {
    res.status(400).json({ error: 'branchId is required for a staff account' });
    return;
  }

  if (phoneNumber && phoneNumber !== existing.phoneNumber) {
    const duplicate = await prisma.user.findUnique({ where: { phoneNumber } });
    if (duplicate) {
      res.status(409).json({ error: 'A user with this phone number already exists' });
      return;
    }
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      fullName: fullName ?? existing.fullName,
      phoneNumber: phoneNumber ?? existing.phoneNumber,
      role: resolvedRole,
      branchId: resolvedBranchId,
    },
    select: USER_LIST_SELECT,
  });

  res.status(200).json({ user });
};

// Admin-only — a real row delete (client ask: "permanently delete from the
// DB"), unlike the isActive soft-deactivation this used to do. DeviceToken
// rows are disposable (just push-notification routing) so they're cleared
// first; order/payment/earnings history (createdOrders, assignedOrders,
// payments, staffEarnings, etc.) does NOT cascade on purpose — deleting
// that would silently orphan real business/audit records. A user with any
// such history hits a foreign-key violation (P2003), caught here and
// turned into a clear 409 rather than bubbling up as a raw Prisma error or
// silently succeeding and losing history. isActive is left untouched on
// that 409 path — the account stays as it was, still login-blocked only if
// it already was.
export const deleteUserHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  if (req.auth!.userId === id) {
    res.status(400).json({ error: 'You cannot delete your own account.' });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  try {
    await prisma.$transaction([
      prisma.deviceToken.deleteMany({ where: { userId: id } }),
      prisma.user.delete({ where: { id } }),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      res.status(409).json({
        error: 'Cannot delete this account — they have order/payment history that must be preserved. Edit their role/branch instead of deleting.',
      });
      return;
    }
    throw err;
  }

  res.status(204).send();
};
