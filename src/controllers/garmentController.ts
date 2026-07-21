import { Response } from 'express';
import prisma from '../prisma/client';
import { AuthRequest } from '../middleware/auth';

// Staff have read-only access to the catalogue; CRUD is admin-only and
// lands with the admin screens (Section D).
export const listGarmentsHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const branchId = req.auth!.branchId;

  const garments = await prisma.garmentCatalogue.findMany({
    where: {
      isActive: true,
      ...(branchId ? { OR: [{ branchId: null }, { branchId }] } : {}),
    },
    orderBy: { displayOrder: 'asc' },
  });

  res.status(200).json({ garments });
};

export const createGarmentHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { itemName, serviceType, price, branchId, displayOrder, requiresSpecialCare } = req.body;

  if (!itemName || !serviceType || price === undefined) {
    res.status(400).json({ error: 'itemName, serviceType, and price are required' });
    return;
  }

  const garment = await prisma.garmentCatalogue.create({
    data: { itemName, serviceType, price, branchId, displayOrder: displayOrder ?? 0, requiresSpecialCare },
  });

  res.status(201).json({ garment });
};

export const updateGarmentHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { itemName, serviceType, price, displayOrder, isActive, requiresSpecialCare } = req.body;

  const garment = await prisma.garmentCatalogue.update({
    where: { id: req.params.id },
    data: { itemName, serviceType, price, displayOrder, isActive, requiresSpecialCare },
  });

  res.status(200).json({ garment });
};

// Soft delete: garment_catalogue.is_active exists precisely so historical
// order_items (which reference garmentId) keep resolving after a garment is
// retired, rather than a hard delete breaking that FK's history.
export const deleteGarmentHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  await prisma.garmentCatalogue.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });

  res.status(204).send();
};
