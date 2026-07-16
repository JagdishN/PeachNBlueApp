import { Response } from 'express';
import prisma from '../prisma/client';
import { AuthRequest } from '../middleware/auth';
import { getAgingReport } from '../services/ledgerService';

// Aggregation only — no new business logic. "Revenue Today" is keyed off
// today's orders (finalAmount), since no payment-webhook data exists yet
// to key it off actual collected payments instead.
export const getSummaryHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const branchId = req.auth!.branchId ?? undefined;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const todaysOrders = await prisma.order.findMany({
    where: {
      pickupDate: { gte: startOfDay, lt: endOfDay },
      ...(branchId ? { customer: { branchId } } : {}),
    },
  });

  const ordersToday = todaysOrders.length;
  const revenueToday = todaysOrders.reduce((sum, order) => sum + Number(order.finalAmount), 0);

  const aging = await getAgingReport(branchId);
  const outstandingDues = aging.reduce((sum, row) => sum + row.outstandingBalance, 0);

  const branchesActive = await prisma.branch.count({
    where: { isActive: true, ...(branchId ? { id: branchId } : {}) },
  });

  res.status(200).json({
    ordersToday,
    revenueToday,
    outstandingDues,
    branchesActive,
  });
};
