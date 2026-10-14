// Client ask (2026-10-14): Dry Cleaning and Wash & Fold take noticeably
// longer than Ironing — this is the single source of truth for that
// distinction, used wherever a turnaround/delivery estimate is shown
// (pickup_confirmation's {{4}} WhatsApp variable, the invoice PDF, and the
// mobile Order Status screen), computed from whichever service type(s) are
// actually on the order rather than one fixed figure for every order.
const hasLongerTurnaround = (serviceTypes: string[]): boolean =>
  serviceTypes.some((type) => type === 'wash_fold' || type === 'dry_clean');

// Plain phrase, not a full sentence — for the pickup_confirmation
// template's {{4}} variable, which is plugged into that template's own
// fixed surrounding text (same convention as every other variable there,
// e.g. {{3}} is just "499", not "Amount: Rs.499").
export const getTurnaroundLabel = (serviceTypes: string[]): string =>
  hasLongerTurnaround(serviceTypes) ? '4-5 business working days' : '24-48 hours';

// Full sentence — for the invoice PDF and the mobile Order Status screen,
// neither of which has any surrounding fixed template text of their own.
export const getTurnaroundText = (serviceTypes: string[]): string =>
  hasLongerTurnaround(serviceTypes)
    ? 'Dry Cleaning and Wash & Fold — expected delivery in 4 to 5 business working days.'
    : 'Turnaround time is typically 24–48 hours from pickup.';
