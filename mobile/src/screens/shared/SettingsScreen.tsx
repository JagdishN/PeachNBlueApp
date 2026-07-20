import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppScreen } from '../../components/AppScreen';
import { useTheme, ThemeMode } from '../../context/ThemeContext';
import { ColorTokens, spacing, radii } from '../../theme/theme';

// First screen to house both a Settings control (light/dark toggle) and the
// About content CLAUDE.md requires ("Technology by NIVENXA" on the About
// page) — bundled into one screen rather than building two, since neither
// existed before this pass. Registered in both AdminStack and StaffStack,
// same duplication pattern OrderStatusScreen already uses across both.
export const SettingsScreen: React.FC = () => {
  const { mode, setMode, colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <AppScreen>
      <View style={styles.appbar}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.toggleRow}>
          {(['light', 'dark'] as ThemeMode[]).map((option) => (
            <Pressable
              key={option}
              style={[styles.toggle, mode === option && styles.toggleActive]}
              onPress={() => setMode(option)}
            >
              <Text style={[styles.toggleText, mode === option && styles.toggleTextActive]}>
                {option === 'light' ? 'Light' : 'Dark'}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.card}>
          <Text style={styles.appName}>Peach & Blue</Text>
          <Text style={styles.tagline}>Fresh. Clean. Perfectly cared for.</Text>
          <Text style={styles.version}>Version 1.0.0</Text>
          <Text style={styles.nivenxa}>Technology by NIVENXA</Text>
        </View>
      </View>
    </AppScreen>
  );
};

const createStyles = (colors: ColorTokens) =>
  StyleSheet.create({
    appbar: {
      backgroundColor: colors.chrome,
      padding: spacing.lg,
      paddingBottom: 14,
    },
    title: {
      fontFamily: 'Lora_600SemiBold',
      fontSize: 16,
      color: colors.cream,
    },
    body: {
      flex: 1,
      padding: 14,
    },
    sectionTitle: {
      fontSize: 12.5,
      fontWeight: '700',
      color: colors.navyText,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    toggleRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    toggle: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderRadius: radii.sm,
      borderWidth: 1.5,
      borderColor: colors.navyDeep,
    },
    toggleActive: {
      backgroundColor: colors.chrome,
      borderColor: colors.chrome,
    },
    toggleText: {
      fontSize: 10.5,
      fontWeight: '700',
      color: colors.navyDeep,
    },
    toggleTextActive: {
      color: colors.cream,
    },
    card: {
      backgroundColor: colors.peachCard,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: spacing.lg,
      alignItems: 'center',
    },
    appName: {
      fontFamily: 'Lora_700Bold',
      fontSize: 18,
      color: colors.peachPrimaryDark,
    },
    tagline: {
      fontSize: 10,
      color: colors.muted,
      marginTop: 4,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    version: {
      fontSize: 10.5,
      color: colors.muted,
      marginTop: spacing.md,
    },
    nivenxa: {
      fontSize: 10.5,
      fontWeight: '700',
      color: colors.navyText,
      marginTop: spacing.xs,
    },
  });
