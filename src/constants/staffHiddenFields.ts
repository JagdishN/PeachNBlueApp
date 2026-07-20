// Single source of truth for field names that must never reach a staff-role
// response — referenced by both the primary defense (role-aware Prisma
// select, src/utils/roleAwareSelect.ts) and the secondary safety net
// (response-shaping middleware, src/middleware/staffFieldFilter.ts).
// discountPercent is the first entry; more admin-only financial fields are
// expected (CLAUDE.md's "monthly plans and discounts, admin-only" future
// feature) — add to this list, don't hardcode a new string elsewhere.
export const STAFF_HIDDEN_FIELDS = ['discountPercent'] as const;

export type StaffHiddenField = (typeof STAFF_HIDDEN_FIELDS)[number];
