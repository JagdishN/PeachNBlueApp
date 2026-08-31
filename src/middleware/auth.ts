import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config';

export interface AuthPayload {
  userId: string;
  role: 'staff' | 'admin';
  branchId: string | null;
  type?: string;
}

export interface AuthRequest extends Request {
  auth?: AuthPayload;
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header missing or malformed' });
    return;
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;

    // A refresh token (see authController.ts) is only ever valid at
    // POST /api/auth/refresh-token — rejecting it here means a stolen
    // refresh token can't also be used directly as a long-lived access
    // token for its full 2-day life.
    if (payload.type === 'refresh') {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    req.auth = payload;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireRole = (roles: Array<'staff' | 'admin'>) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    if (!roles.includes(req.auth.role)) {
      res.status(403).json({ error: 'Forbidden: insufficient permissions' });
      return;
    }

    next();
  };
};

export const requireBranchScope = (allowGlobalAdmin = true) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    if (req.auth.role === 'admin' && allowGlobalAdmin) {
      next();
      return;
    }

    if (!req.auth.branchId) {
      res.status(403).json({ error: 'Forbidden: branch scoped user required' });
      return;
    }

    next();
  };
};
