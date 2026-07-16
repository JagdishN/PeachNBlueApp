import { Response } from 'express';
import prisma from '../prisma/client';
import { AuthRequest } from '../middleware/auth';

export const registerDeviceHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { expoPushToken, platform } = req.body;

  if (!expoPushToken || !platform) {
    res.status(400).json({ error: 'expoPushToken and platform are required' });
    return;
  }

  await prisma.deviceToken.upsert({
    where: { expoPushToken },
    update: { userId: req.auth!.userId, platform },
    create: { expoPushToken, platform, userId: req.auth!.userId },
  });

  res.status(200).json({ message: 'Device registered' });
};
