import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme/theme';

// Fixed, non-themable NIVENXA attribution — CLAUDE.md: "Powered by NIVENXA"
// footer on every screen. Styling intentionally does not use Peach & Blue
// theme colors so it always reads as the app builder's mark, not the client's.
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
// rather than a placeholder image.
export const SplashLogo: React.FC<SplashLogoProps> = ({ size = 'large' }) => {
  const isLarge = size === 'large';
  return (
    <View style={styles.logoWrap}>
      <Text style={[styles.logoWord, { fontSize: isLarge ? 30 : 19, color: colors.peachPrimaryDark }]}>Peach</Text>
      <Text style={[styles.logoAmp, { fontSize: isLarge ? 22 : 15 }]}>&amp;</Text>
      <Text style={[styles.logoWord, { fontSize: isLarge ? 30 : 19, color: colors.navyDeep }]}>Blue</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  footer: {
    height: 22,
    backgroundColor: colors.navyDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerText: {
    color: colors.border,
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
    color: colors.navyDeep,
  },
});
