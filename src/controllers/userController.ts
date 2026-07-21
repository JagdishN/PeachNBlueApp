import { Request, Response } from 'express';
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

  const users = await prisma.user.findMany({
    where: effectiveBranchId ? { branchId: effectiveBranchId } : undefined,
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
