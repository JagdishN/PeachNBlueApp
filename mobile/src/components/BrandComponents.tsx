import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { fonts } from '../theme/theme';

// Nivenxa Technologies attribution URL — CLAUDE.md "Non-negotiables":
// deliberately routes to the software arm specifically (nivenxa.com's
// /technologies path), not the parent NIVENXA brand generally, for
// marketing/lead-generation value. Treated as a firm-wide template decision
// for future client apps, not a Peach & Blue-specific choice.
const NIVENXA_TECHNOLOGIES_URL = 'https://nivenxa.com/technologies';

// Fixed, non-themable Nivenxa Technologies attribution — CLAUDE.md: a
// tappable "Powered by Nivenxa Technologies" footer on every screen (splash
// screen carries the same wording but stays non-interactive — see
// SplashScreen.tsx). Deliberately hardcoded literal hex, not theme tokens
// (not even the "fixed" chrome/cream tokens) — this must always read as the
// app builder's mark, independent of anything Peach & Blue themes, including
// any future rebrand of the app's own palette.
export const NivenxaFooter: React.FC = () => (
  <Pressable
    style={styles.footer}
    onPress={() => Linking.openURL(NIVENXA_TECHNOLOGIES_URL)}
    accessibilityRole="link"
    // The footer bar itself stays a visually subtle 22px strip (original
    // branding requirement), but that's too thin a real tap target on its
    // own — hitSlop pads the actual touchable area beyond the visible bar
    // without growing it on screen.
    hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
  >
    <Text style={styles.footerText}>POWERED BY NIVENXA TECHNOLOGIES</Text>
  </Pressable>
);

interface SplashLogoProps {
  size?: 'large' | 'small';
}

// Text-based "Peach & Blue" wordmark — no logo source file exists yet
// (open item in CLAUDE.md), so this mirrors the mockup's styled-text treatment
// rather than a placeholder image. Themed, unlike NivenxaFooter above — this
// is the client's brand wordmark, not the builder's mark.
export const SplashLogo: React.FC<SplashLogoProps> = ({ size = 'large' }) => {
  const { colors } = useTheme();
  const isLarge = size === 'large';
  return (
    <View style={styles.logoWrap}>
      <Text style={[styles.logoWord, { fontSize: isLarge ? 30 : 19, color: colors.peachPrimaryDark }]}>Peach</Text>
      <Text style={[styles.logoAmp, { fontSize: isLarge ? 22 : 15, color: colors.navyDeep }]}>&amp;</Text>
      <Text style={[styles.logoWord, { fontSize: isLarge ? 30 : 19, color: colors.navyDeep }]}>Blue</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  footer: {
    height: 22,
    backgroundColor: '#0E2142',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerText: {
    color: '#E9CDAC',
    fontSize: 8.5,
    fontWeight: '600',
    letterSpacing: 0.5,
    // Subtle tappability affordance — same convention as the About-page
    // credit (SettingsScreen.tsx), not a new pattern invented here.
    textDecorationLine: 'underline',
  },
  logoWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  logoWord: {
    fontFamily: fonts.heading,
    fontWeight: '700',
  },
  logoAmp: {
    fontFamily: fonts.headingItalic,
    fontStyle: 'italic',
    fontWeight: '600',
  },
});
