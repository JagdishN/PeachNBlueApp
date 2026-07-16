import { NextFunction, Request, Response } from 'express';

export const errorHandler = (err: unknown, req: Request, res: Response, next: NextFunction): void => {
  console.error(err);

  const status = (err as any)?.status ?? 500;
  const message = (err as any)?.message ?? 'Internal server error';

  res.status(status).json({
    error: message,
  });
};
