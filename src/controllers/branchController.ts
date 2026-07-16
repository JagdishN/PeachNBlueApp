import { Response } from 'express';
import prisma from '../prisma/client';
import { AuthRequest } from '../middleware/auth';

export const getBranchHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  // Branch-scoped users (staff, or an admin scoped to one branch) may only
  // read their own branch — only an unscoped (branchId === null) admin can
  // read any branch, per CLAUDE.md's admin scoping rule.
  if (req.auth!.branchId && req.auth!.branchId !== id) {
    res.status(403).json({ error: 'Forbidden: branch mismatch' });
    return;
  }

  const branch = await prisma.branch.findUnique({ where: { id } });

  if (!branch) {
    res.status(404).json({ error: 'Branch not found' });
    return;
  }

  res.status(200).json({ branch });
};

// Unscoped admin only — see getBranchHandler's scoping comment for why a
// branch-scoped admin can't list beyond their own branch.
export const listBranchesHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const branchId = req.auth!.branchId;

  const branches = await prisma.branch.findMany({
    where: branchId ? { id: branchId } : undefined,
    orderBy: { branchName: 'asc' },
  });

  res.status(200).json({ branches });
};

export const createBranchHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { branchName, branchType, phoneNumber, whatsappNumber, address, city } = req.body;

  if (!branchName || !branchType || !phoneNumber || !address || !city) {
    res.status(400).json({ error: 'branchName, branchType, phoneNumber, address, and city are required' });
    return;
  }

  const branch = await prisma.branch.create({
    data: { branchName, branchType, phoneNumber, whatsappNumber, address, city },
  });

  res.status(201).json({ branch });
};

export const updateBranchHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { branchName, branchType, phoneNumber, whatsappNumber, address, city, isActive } = req.body;

  const branch = await prisma.branch.update({
    where: { id: req.params.id },
    data: { branchName, branchType, phoneNumber, whatsappNumber, address, city, isActive },
  });

  res.status(200).json({ branch });
};
