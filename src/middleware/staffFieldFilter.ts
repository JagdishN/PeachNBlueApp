import { Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { AuthRequest } from './auth';
import { STAFF_HIDDEN_FIELDS } from '../constants/staffHiddenFields';

// Decimal and Date instances must be treated as leaves, not recursed into —
// naively walking their internal properties (decimal.js's Decimal has `d`,
// `e`, `s` digit/exponent/sign fields) wastes work at best and risks
// breaking their shape at worst. This also means they're returned as-is
// rather than reconstructed, so res.json()'s own serialization still runs
// on the original Decimal/Date value afterward.
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  !(value instanceof Prisma.Decimal);

// Returns a new tree with every key in `fields` removed at any depth —
// doesn't mutate the input, so nothing upstream that still holds a
// reference to the original response object is affected.
export const stripFields = (value: unknown, fields: readonly string[]): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => stripFields(item, fields));
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (fields.includes(key)) continue;
      result[key] = stripFields(val, fields);
    }
    return result;
  }

  return value;
};

// Secondary safety net (CLAUDE.md "Architecture decision, resolved" under
// "Per-flat discounts"). The primary defense is a role-aware Prisma
// `select` at each query site that fetches Customer data
// (src/utils/roleAwareSelect.ts) — this middleware exists to catch
// whatever a future endpoint forgets to exclude there, not to be the main
// line of defense.
//
// Must be registered in server.ts before any route handlers, and — if a
// request/response logger is ever added — before that logger too, so this
// stays the OUTERMOST res.json wrapper. A logger registered after this
// line logs the already-filtered body; one registered before it sees the
// raw, unfiltered body and leaks sensitive fields into logs even though
// the HTTP response itself is clean. No logger exists in this codebase
// yet (checked server.ts) — this ordering requirement is for whoever adds
// one later.
export const staffFieldFilter = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    if (req.auth?.role === 'staff') {
      return originalJson(stripFields(body, STAFF_HIDDEN_FIELDS));
    }
    return originalJson(body);
  }) as Response['json'];

  next();
};
