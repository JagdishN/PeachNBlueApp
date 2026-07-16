// Color/spacing tokens transcribed from docs/PeachBlue_App_Screens_Mockup.html.
// These are the mockup's first-pass hex values, not final brand colors — per
// CLAUDE.md, replace once the client sends the logo source file (SVG/AI).
export const colors = {
  peachBg: '#FBE9D9',
  peachCard: '#FFF6EC',
  peachPrimary: '#F2764A',
  peachPrimaryDark: '#D65E36',
  navy: '#17315E',
  navyText: '#16305C',
  navyDeep: '#0E2142',
  cream: '#FFFAF4',
  success: '#3F8F6B',
  successBg: '#E4F3EC',
  warning: '#C97A2B',
  warningBg: '#FBEBD8',
  danger: '#C24545',
  border: '#E9CDAC',
  white: '#FFFFFF',
  muted: '#8A7355',
} as const;

export const fonts = {
  heading: 'Lora_700Bold',
  headingSemiBold: 'Lora_600SemiBold',
  headingItalic: 'Lora_600SemiBold_Italic',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
  bodyExtraBold: 'Inter_800ExtraBold',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 9,
  lg: 12,
  pill: 100,
} as const;

export const theme = { colors, fonts, spacing, radii };

export type Theme = typeof theme;
