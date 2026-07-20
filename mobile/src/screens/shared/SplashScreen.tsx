import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { ColorTokens } from '../../theme/theme';
import { SplashLogo } from '../../components/BrandComponents';

// Presentational only — App.tsx owns the 2-second timer and decides when
// this unmounts. Shown on every cold start, never gated by a "seen before"
// flag, per CLAUDE.md.
export const SplashScreen: React.FC = () => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.splash}>
      <SplashLogo size="large" />
      <Text style={styles.tagline}>Fresh. Clean. Perfectly cared for.</Text>
      <View style={styles.poweredBy}>
        <Text style={styles.poweredByText}>Powered by NIVENXA</Text>
      </View>
    </View>
  );
};

const createStyles = (colors: ColorTokens) =>
  StyleSheet.create({
    splash: {
      flex: 1,
      backgroundColor: colors.peachBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tagline: {
      marginTop: 10,
      fontSize: 10,
      letterSpacing: 2,
      textTransform: 'uppercase',
      color: colors.warning,
    },
    poweredBy: {
      position: 'absolute',
      bottom: 34,
    },
    poweredByText: {
      fontSize: 9,
      letterSpacing: 0.5,
      color: colors.muted,
    },
  });
