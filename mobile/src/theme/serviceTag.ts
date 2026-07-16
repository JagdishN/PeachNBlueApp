import { colors } from './theme';
import { ServiceType } from '../api/garments';

// The bag artwork shows three services (Wash & Fold, Ironing, Dry Cleaning)
// but the backend's service_type enum is laundry/iron/both — CLAUDE.md
// flags this as an open question pending client confirmation. This is just
// a display mapping for the current enum, not a resolution of that question.
export const SERVICE_TAG: Record<ServiceType, { label: string; bg: string; color: string }> = {
  laundry: { label: 'Wash & Fold', bg: '#DCEAE3', color: colors.success },
  iron: { label: 'Ironing', bg: '#E1E9F5', color: colors.navy },
  both: { label: 'Wash & Iron', bg: colors.warningBg, color: colors.warning },
};
