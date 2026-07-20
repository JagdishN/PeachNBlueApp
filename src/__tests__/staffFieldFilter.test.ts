import { Prisma } from '@prisma/client';
import { stripFields, staffFieldFilter } from '../middleware/staffFieldFilter';
import { STAFF_HIDDEN_FIELDS } from '../constants/staffHiddenFields';

describe('stripFields (safety-net field walker)', () => {
  it('removes a top-level hidden field', () => {
    expect(stripFields({ discountPercent: 10, fullName: 'X' }, STAFF_HIDDEN_FIELDS)).toEqual({ fullName: 'X' });
  });

  it('removes a nested hidden field (order.customer.discountPercent)', () => {
    const input = { order: { id: 'o-1', customer: { fullName: 'X', discountPercent: 15 } } };
    expect(stripFields(input, STAFF_HIDDEN_FIELDS)).toEqual({ order: { id: 'o-1', customer: { fullName: 'X' } } });
  });

  it('removes hidden fields inside arrays', () => {
    const input = {
      orders: [
        { customer: { fullName: 'A', discountPercent: 5 } },
        { customer: { fullName: 'B', discountPercent: 0 } },
      ],
    };
    expect(stripFields(input, STAFF_HIDDEN_FIELDS)).toEqual({
      orders: [{ customer: { fullName: 'A' } }, { customer: { fullName: 'B' } }],
    });
  });

  it('catches a Decimal-typed discountPercent (not just plain numbers)', () => {
    const input = { customer: { fullName: 'X', discountPercent: new Prisma.Decimal('12.50') } };
    expect(stripFields(input, STAFF_HIDDEN_FIELDS)).toEqual({ customer: { fullName: 'X' } });
  });

  it('passes Decimal and Date values through unchanged when not hidden, without throwing', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const amount = new Prisma.Decimal('249.00');
    const input = { order: { createdAt, amount, customer: { fullName: 'X' } } };

    const result = stripFields(input, STAFF_HIDDEN_FIELDS) as any;

    expect(result.order.createdAt).toBe(createdAt);
    expect(result.order.amount).toBe(amount);
    expect(result.order.amount.toString()).toBe('249');
  });

  it('does not throw or hang on a structure mixing arrays, Decimals, and Dates', () => {
    const input = {
      orders: Array.from({ length: 20 }, (_, i) => ({
        id: `o-${i}`,
        createdAt: new Date(),
        finalAmount: new Prisma.Decimal(i * 10),
        customer: { fullName: `Customer ${i}`, discountPercent: new Prisma.Decimal(i) },
      })),
    };

    expect(() => stripFields(input, STAFF_HIDDEN_FIELDS)).not.toThrow();
  });
});

describe('staffFieldFilter middleware', () => {
  function callMiddleware(role: 'staff' | 'admin' | undefined) {
    const captured: unknown[] = [];
    const req: any = { auth: role ? { role } : undefined };
    const res: any = {
      json: jest.fn(function (this: unknown, body: unknown) {
        captured.push(body);
        return this;
      }),
    };
    const next = jest.fn();

    staffFieldFilter(req, res, next);
    expect(next).toHaveBeenCalled();

    return { res, captured };
  }

  it('strips discountPercent for a staff-role response, including nested customer objects', () => {
    const { res, captured } = callMiddleware('staff');

    res.json({ order: { customer: { discountPercent: 10, fullName: 'X' } } });

    expect(captured[0]).toEqual({ order: { customer: { fullName: 'X' } } });
  });

  it('leaves admin-role responses untouched', () => {
    const { res, captured } = callMiddleware('admin');

    res.json({ order: { customer: { discountPercent: 10, fullName: 'X' } } });

    expect(captured[0]).toEqual({ order: { customer: { discountPercent: 10, fullName: 'X' } } });
  });

  it('leaves unauthenticated responses untouched (no req.auth)', () => {
    const { res, captured } = callMiddleware(undefined);

    res.json({ discountPercent: 10 });

    expect(captured[0]).toEqual({ discountPercent: 10 });
  });

  it('acts as the safety net when the primary defense is bypassed — strips a field that should never have been fetched', () => {
    // Simulates a query site that (incorrectly) used `include: { customer: true }`
    // instead of the role-aware select — the field reaches the response layer,
    // and this middleware is the last line of defense against it leaking.
    const { res, captured } = callMiddleware('staff');

    res.json({
      orders: [
        { id: 'o-1', customer: { fullName: 'A', discountPercent: 5 } },
        { id: 'o-2', customer: { fullName: 'B', discountPercent: 0 } },
      ],
    });

    expect(captured[0]).toEqual({
      orders: [{ id: 'o-1', customer: { fullName: 'A' } }, { id: 'o-2', customer: { fullName: 'B' } }],
    });
  });
});
