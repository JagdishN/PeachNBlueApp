import { ColorTokens } from './theme';
import { ServiceType } from '../api/garments';

// Confirmed values per CLAUDE.md "Services — RESOLVED": wash_fold, ironing,
// dry_clean. There is no `specialty_care` service type — special-care
// handling is the orthogonal `requiresSpecialCare` boolean instead (see
// CLAUDE.md "requiresSpecialCare — RESOLVED"), surfaced as its own badge,
// not a service tag.
//
// A function, not a static object — the pastel chip backgrounds below are
// deliberately fixed regardless of theme (small self-contained badges, same
// treatment CLAUDE.md's "chip" pattern uses elsewhere), so their paired
// foreground text must also stay fixed rather than following the theme-
// reactive `navy`/`navyText` tokens (which flip to a LIGHT color in dark
// mode — fine for body text on a surface that also flips, but would go
// invisible against these chips' fixed light pastel backgrounds). Only
// `dry_clean` uses theme-reactive colors, matching the same warningBg/warning
// pairing used elsewhere in the app (e.g. NewOrderEntryScreen's minimum-kg
// banner) for a consistent "warning" look in both themes.
export const getServiceTag = (
  colors: ColorTokens
): Record<ServiceType, { label: string; bg: string; color: string }> => ({
  wash_fold: { label: 'Wash & Fold', bg: '#DCEAE3', color: colors.success },
  ironing: { label: 'Ironing', bg: '#E1E9F5', color: '#17315E' },
  dry_clean: { label: 'Dry Clean', bg: colors.warningBg, color: colors.warning },
});

// Fixed pastel badge for requiresSpecialCare — same "small self-contained
// chip, colors fixed regardless of theme" treatment as getServiceTag above,
// kept as a separate export since it's an orthogonal attribute, not a
// service type (would be a Partial<Record<ServiceType,...>> bug otherwise).
export const SPECIAL_CARE_TAG = { label: 'Special Care', bg: '#F1E1F5', color: '#6B1F80' };
