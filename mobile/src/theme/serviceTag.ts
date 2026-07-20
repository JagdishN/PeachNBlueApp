import { colors } from './theme';
import { ServiceType } from '../api/garments';

// Confirmed values per CLAUDE.md "Services — RESOLVED":
// wash_fold, ironing, dry_clean, specialty_care.
export const SERVICE_TAG: Record<ServiceType, { label: string; bg: string; color: string }> = {
  wash_fold: { label: 'Wash & Fold', bg: '#DCEAE3', color: colors.success },
  ironing: { label: 'Ironing', bg: '#E1E9F5', color: colors.navy },
  dry_clean: { label: 'Dry Clean', bg: colors.warningBg, color: colors.warning },
  specialty_care: { label: 'Specialty Care', bg: '#F1E1F5', color: colors.navy },
};
