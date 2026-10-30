import { toPaise, fromPaise, addPaise, subPaise, clampNonNegative } from '../utils/money';

describe('money (paise conversion)', () => {
  it('converts a plain number of rupees to integer paise', () => {
    expect(toPaise(249.5)).toBe(24950n);
    expect(toPaise(1000)).toBe(100000n);
  });

  it('converts a Prisma Decimal-like object (via toString) without floating-point drift', () => {
    const decimalLike = { toString: () => '880.00' };
    expect(toPaise(decimalLike)).toBe(88000n);
  });

  it('rounds to the nearest paisa rather than truncating', () => {
    expect(toPaise(10.005)).toBe(1001n); // 1000.5 rounds up
  });

  it('throws on a non-finite value rather than silently producing 0n', () => {
    expect(() => toPaise(NaN)).toThrow();
    expect(() => toPaise('not-a-number')).toThrow();
  });

  it('converts paise back to a rupee number', () => {
    expect(fromPaise(24950n)).toBe(249.5);
    expect(fromPaise(100000n)).toBe(1000);
  });

  it('adds and subtracts paise as bigint arithmetic', () => {
    expect(addPaise(100n, 50n)).toBe(150n);
    expect(subPaise(100n, 150n)).toBe(-50n);
  });

  it('clamps a negative value to zero, leaves a non-negative value untouched', () => {
    expect(clampNonNegative(-50n)).toBe(0n);
    expect(clampNonNegative(50n)).toBe(50n);
    expect(clampNonNegative(0n)).toBe(0n);
  });
});
