import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import * as orderService from '../services/orderService';

export const createOrderHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { customerName, customerPhoneNumber, locationLabel, branchId, pickupDate, items, staffId } = req.body;

  if (!customerName || !customerPhoneNumber || !locationLabel || !branchId || !pickupDate || !Array.isArray(items)) {
    res.status(400).json({ error: 'customerName, customerPhoneNumber, locationLabel, branchId, pickupDate, and items are required' });
    return;
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
