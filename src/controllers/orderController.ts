import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import * as orderService from '../services/orderService';

export const createOrderHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { customerName, customerPhoneNumber, locationLabel, branchId, pickupDate, items, staffId } = req.body;

  if (!customerName || !customerPhoneNumber || !locationLabel || !branchId || !pickupDate || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'customerName, customerPhoneNumber, locationLabel, branchId, pickupDate, and a non-empty items array are required' });
    return;
  }

  // Per-item shape check only — which of quantity/weightKg/chosenPrice is
  // actually required depends on the linked garment's pricingUnit and
  // isStartingPrice/priceMax, so that validation happens in orderService
  // once the garment rows are loaded.
  for (const item of items) {
    if (!item.garmentId || typeof item.garmentId !== 'string') {
      res.status(400).json({ error: 'Each item requires a garmentId' });
      return;
    }
    if (item.quantity !== undefined && (typeof item.quantity !== 'number' || item.quantity <= 0)) {
      res.status(400).json({ error: `Invalid quantity for garment ${item.garmentId}` });
      return;
    }
    if (item.weightKg !== undefined && (typeof item.weightKg !== 'number' || item.weightKg <= 0)) {
      res.status(400).json({ error: `Invalid weightKg for garment ${item.garmentId}` });
      return;
    }
    if (item.chosenPrice !== undefined && (typeof item.chosenPrice !== 'number' || item.chosenPrice <= 0)) {
      res.status(400).json({ error: `Invalid chosenPrice for garment ${item.garmentId}` });
      return;
    }
  }

  const order = await orderService.createOrder({
    createdById: req.auth!.userId,
    staffId,
    branchId,
    customerName,
    customerPhoneNumber,
    locationLabel,
    pickupDate: new Date(pickupDate),
    items,
  });

  res.status(201).json({ order });
};

export const listOrdersHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { branchId, date } = req.query;

  const effectiveBranchId = req.auth!.role === 'admin' && !req.auth!.branchId
    ? (typeof branchId === 'string' ? branchId : undefined)
    : req.auth!.branchId ?? undefined;

  const orders = await orderService.listOrders({
    branchId: effectiveBranchId,
    date: typeof date === 'string' ? new Date(date) : new Date(),
  });

  res.status(200).json({ orders });
};

export const getOrderHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const order = await orderService.getOrder(req.params.id);

  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  res.status(200).json({ order });
};

export const updateStatusHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { status } = req.body;

  if (!status) {
    res.status(400).json({ error: 'status is required' });
    return;
  }

  const order = await orderService.updateStatus(req.params.id, status, req.auth!.userId);
  res.status(200).json({ order });
};

export const reviseAmountHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { newAmount, reason } = req.body;

  if (newAmount === undefined || !reason) {
    res.status(400).json({ error: 'newAmount and reason are required' });
    return;
  }

  const order = await orderService.reviseAmount(req.params.id, Number(newAmount), reason, req.auth!.userId);
  res.status(200).json({ order });
};
