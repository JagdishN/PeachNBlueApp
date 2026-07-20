// Color/spacing tokens transcribed from docs/PeachBlue_App_Screens_Mockup.html.
// These are the mockup's first-pass hex values, not final brand colors — per
// CLAUDE.md, replace once the client sends the logo source file (SVG/AI).
//
// Token roles (why some values are identical across light/dark and some flip):
// - `peachPrimary`/`peachPrimaryDark`/`white` — brand accent + button-label
//   text. Fixed: buttons should read the same regardless of theme.
// - `chrome` — the dark navy bar used for every app bar/footer/tab bar/total
//   bar. Fixed: it's already a deliberately-dark accent bar sitting in an
//   otherwise light UI, not something that needs to get "darker" for dark
//   mode — kept visually consistent across both themes.
// - `cream` — light, near-white text color used for titles sitting on the
//   fixed `chrome` bar. Fixed for the same reason `chrome` is.
// - `surface` — input fields and modal sheets. Flips (was conflated with
//   `white`/`cream` in the original single-palette version, which broke once
//   those two also had to stay fixed for the header-text/button-text role).
// - `peachBg`/`peachCard`/`navy`/`navyText`/`navyDeep`/`border`/`muted` —
//   screen backgrounds, card surfaces, and body text/borders. All flip.
// - `success`/`warning`/`danger` — fixed (small saturated accents still read
//   fine against either theme's adjusted `*Bg` pill backgrounds).
// - `successBg`/`warningBg` — flip (pale pill backgrounds need a dark-mode
//   equivalent so they don't look like bright rectangles on a dark screen).
export const lightColors = {
  peachBg: '#FBE9D9',
  peachCard: '#FFF6EC',
  peachPrimary: '#F2764A',
  peachPrimaryDark: '#D65E36',
  navy: '#17315E',
  navyText: '#16305C',
  navyDeep: '#0E2142',
  chrome: '#0E2142',
  cream: '#FFFAF4',
  surface: '#FFFFFF',
  success: '#3F8F6B',
  successBg: '#E4F3EC',
  warning: '#C97A2B',
  warningBg: '#FBEBD8',
  danger: '#C24545',
  border: '#E9CDAC',
  white: '#FFFFFF',
  muted: '#8A7355',
} as const;

// Widened to `string` (not the literal-per-key type `typeof lightColors`
// would infer) — darkColors needs to assign genuinely different hex values
// per key while still being checked for exact key parity with lightColors.
export type ColorTokens = { [K in keyof typeof lightColors]: string };

export const darkColors: ColorTokens = {
  peachBg: '#15213A',
  peachCard: '#1E2C48',
  peachPrimary: '#F2764A',
  peachPrimaryDark: '#D65E36',
  navy: '#C7D3EA',
  navyText: '#EDE6DA',
  navyDeep: '#F5EFE6',
  chrome: '#0E2142',
  cream: '#FFFAF4',
  surface: '#243452',
  success: '#3F8F6B',
  successBg: '#1E3A2E',
  warning: '#C97A2B',
  warningBg: '#3D2C14',
  danger: '#C24545',
  border: '#3A4A6B',
  white: '#FFFFFF',
  muted: '#9AA7C4',
};

// Deprecated static export — kept removed intentionally. Every consumer now
// reads colors via useTheme() so the app can react to a runtime theme change;
// re-adding a static `colors` export here would let a new file accidentally
// bypass theming, so don't.

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

export const theme = { lightColors, darkColors, fonts, spacing, radii };
