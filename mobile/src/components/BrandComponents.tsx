import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { fonts } from '../theme/theme';

// Fixed, non-themable NIVENXA attribution — CLAUDE.md: "Powered by NIVENXA"
// footer on every screen. Deliberately hardcoded literal hex, not theme
// tokens (not even the "fixed" chrome/cream tokens) — this must always read
// as the app builder's mark, independent of anything Peach & Blue themes,
// including any future rebrand of the app's own palette.
export const NivenxaFooter: React.FC = () => (
  <View style={styles.footer}>
    <Text style={styles.footerText}>POWERED BY NIVENXA</Text>
  </View>
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
  },
});
