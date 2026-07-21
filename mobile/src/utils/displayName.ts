// CLAUDE.md "Admin accounts" — admin display naming: general UI shows the
// clean name ("PeachandBlue") with a "(Admin N)"-style internal-only suffix
// stripped; audit-trail contexts (order_amount_revisions.revisedBy,
// payments.recordedBy, order_status_history.changedBy) should keep the full
// fullName so different admins stay distinguishable there. No audit-trail UI
// exists yet (checked — nothing renders those fields), so this derivation is
// only actually applied in "general" contexts today (e.g. StaffManagement's
// account list). A derivation, not a stored `displayName` column — mirrors
// this codebase's existing internalStatus-vs-customer-facing-label
// convention of deriving in application code rather than duplicating state
// that can drift out of sync.
export const getDisplayName = (fullName: string): string => fullName.replace(/\s*\([^)]*\)\s*$/, '');
