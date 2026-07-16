import { Request, Response } from 'express';

export const getCurrentUser = async (req: Request, res: Response): Promise<void> => {
  const auth = (req as any).auth;

  if (!auth) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }

  res.status(200).json({ user: auth });
};
