import { NextFunction, Request, Response } from 'express';

export const errorHandler = (err: unknown, req: Request, res: Response, next: NextFunction): void => {
  console.error(err);

  const status = (err as any)?.status;

  // Only a deliberately-thrown app error has a message safe to show a
  // client — every one of those in this codebase sets .status explicitly
  // (e.g. orderService.ts's `(err as any).status = 400; throw err;`) with
  // hand-written, user-facing text. An error with no .status is an
  // unexpected/raw exception instead — a Prisma connection failure, a
  // library bug, etc. — whose .message can carry internal details (DB
  // hostnames, stack info, credentials-adjacent text) that must never reach
  // the client. Real bug found 2026-10-28: a Supabase auth failure's raw
  // Prisma error (hostname included) was returned straight to the login
  // screen. Full error is still logged above either way.
  const message = status !== undefined ? (err as any)?.message ?? 'Internal server error' : 'Internal server error';

  res.status(status ?? 500).json({
    error: message,
  });
};
