// Single source of truth for field names that must never reach a staff-role
// response — referenced by both the primary defense (role-aware Prisma
// select, src/utils/roleAwareSelect.ts) and the secondary safety net
// (response-shaping middleware, src/middleware/staffFieldFilter.ts).
// discountEnabled joins discountPercent here (CLAUDE.md "Monthly billing +
// discount: now live") — same sensitivity, same treatment. Note billingMode
// is deliberately NOT in this list despite also being admin-only to change:
// staff need to read it at delivery to know whether to collect payment.
export const STAFF_HIDDEN_FIELDS = ['discountPercent', 'discountEnabled'] as const;

export type StaffHiddenField = (typeof STAFF_HIDDEN_FIELDS)[number];
