import { calculatePayableAmount } from '../utils/pricing';

describe('calculatePayableAmount', () => {
  it('returns the full amount when discountEnabled is false, even with a stored percent', () => {
    expect(calculatePayableAmount(1000, { discountEnabled: false, discountPercent: 10 })).toBe(1000);
  });

  it('applies the percent when discountEnabled is true', () => {
    expect(calculatePayableAmount(1000, { discountEnabled: true, discountPercent: 10 })).toBe(900);
  });

  it('treats a null discountPercent as 0 when enabled', () => {
    expect(calculatePayableAmount(1000, { discountEnabled: true, discountPercent: null })).toBe(1000);
  });

  it('rounds to 2 decimal places', () => {
    expect(calculatePayableAmount(100, { discountEnabled: true, discountPercent: 33.333 })).toBe(66.67);
  });
});
