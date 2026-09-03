import { extractPaymentLinkSuffix } from '../utils/paymentLink';

// CORRECTED (2026-09-03): confirmed via a real live send + human tap that
// Meta concatenates the button suffix onto the template's configured base
// URL with NO separator — "https://rzp.io/rzp" + "xA7TkwF" produced the
// broken "https://rzp.io/rzpxA7TkwF". The suffix must supply its own
// leading "/".
describe('extractPaymentLinkSuffix', () => {
  it('extracts the last path segment of a Razorpay short URL, with a leading slash', () => {
    expect(extractPaymentLinkSuffix('https://rzp.io/l/AbCd1234')).toBe('/AbCd1234');
  });

  it('handles a trailing slash on the input', () => {
    expect(extractPaymentLinkSuffix('https://rzp.io/l/AbCd1234/')).toBe('/AbCd1234');
  });

  it('handles a real Razorpay link (rzp.io/rzp/... shape, confirmed by a real send)', () => {
    expect(extractPaymentLinkSuffix('https://rzp.io/rzp/xA7TkwF')).toBe('/xA7TkwF');
  });

  it('adds a leading slash even when the input has no path segments', () => {
    expect(extractPaymentLinkSuffix('AbCd1234')).toBe('/AbCd1234');
  });
});
