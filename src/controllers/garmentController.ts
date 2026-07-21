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

// Shared by create/update — CLAUDE.md "requiresSpecialCare — RESOLVED" known
// gap: category/pricingUnit/priceMax/isStartingPrice/requiresSpecialCare
// were seed-managed only, never wired into the admin CRUD handlers. Returns
// an error string on failure, undefined on success (values are validated,
// not yet applied — caller assigns them into its own create/update data).
const validatePricingFields = (body: any): string | undefined => {
  if (body.pricingUnit !== undefined && body.pricingUnit !== 'per_piece' && body.pricingUnit !== 'per_kg') {
    return "pricingUnit must be 'per_piece' or 'per_kg'";
  }
  if (body.priceMax !== undefined && body.priceMax !== null) {
    const price = Number(body.price);
    const priceMax = Number(body.priceMax);
    if (Number.isNaN(priceMax) || (body.price !== undefined && priceMax < price)) {
      return 'priceMax must be a number greater than or equal to price';
    }
  }
  if (body.isStartingPrice !== undefined && typeof body.isStartingPrice !== 'boolean') {
    return 'isStartingPrice must be a boolean';
  }
  if (body.requiresSpecialCare !== undefined && typeof body.requiresSpecialCare !== 'boolean') {
    return 'requiresSpecialCare must be a boolean';
  }
  return undefined;
};

export const createGarmentHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    itemName,
    serviceType,
    price,
    branchId,
    displayOrder,
    category,
    pricingUnit,
    priceMax,
    isStartingPrice,
    requiresSpecialCare,
  } = req.body;

  if (!itemName || !serviceType || price === undefined) {
    res.status(400).json({ error: 'itemName, serviceType, and price are required' });
    return;
  }

  const validationError = validatePricingFields(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const garment = await prisma.garmentCatalogue.create({
    data: {
      itemName,
      serviceType,
      price,
      branchId,
      displayOrder: displayOrder ?? 0,
      category,
      pricingUnit,
      priceMax,
      isStartingPrice,
      requiresSpecialCare,
    },
  });

  res.status(201).json({ garment });
};

export const updateGarmentHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    itemName,
    serviceType,
    price,
    displayOrder,
    isActive,
    category,
    pricingUnit,
    priceMax,
    isStartingPrice,
    requiresSpecialCare,
  } = req.body;

  const validationError = validatePricingFields(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const garment = await prisma.garmentCatalogue.update({
    where: { id: req.params.id },
    data: {
      itemName,
      serviceType,
      price,
      displayOrder,
      isActive,
      category,
      pricingUnit,
      priceMax,
      isStartingPrice,
      requiresSpecialCare,
    },
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
