import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppScreen } from '../../components/AppScreen';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { ColorTokens, fonts, spacing, radii } from '../../theme/theme';

// Houses the About content CLAUDE.md requires ("Technology by NIVENXA" on
// the About page) plus Log Out — previously there was no way to sign out
// anywhere in the app at all (AuthContext.signOut existed but nothing
// called it). The light/dark toggle used to live here as a two-button row —
// moved to a single icon switch directly on the Admin/Staff home app bars
// instead (components/ThemeToggle.tsx), so flipping the theme doesn't need
// a trip into Settings. Registered in both AdminStack and StaffStack, same
// duplication pattern OrderStatusScreen already uses across both.
export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { signOut } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <AppScreen>
      <View style={styles.appbar}>
        <View style={styles.appbarRow}>
          {/* AdminStack/StaffStack both run with headerShown: false, so
              there's no native back button anywhere — this screen needs its
              own, same as any other pushed (non-tab) screen would. */}
          <Pressable style={styles.backButton} onPress={() => navigation.goBack()} hitSlop={8}>
            <MaterialCommunityIcons name="chevron-left" size={22} color={colors.cream} />
          </Pressable>
          <Text style={styles.title}>Settings</Text>
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.card}>
          <Text style={styles.appName}>Peach & Blue</Text>
          <Text style={styles.tagline}>Fresh. Clean. Perfectly cared for.</Text>
          <Text style={styles.version}>Version 1.0.0</Text>
          <Text style={styles.nivenxa}>Technology by NIVENXA</Text>
        </View>

        <Text style={styles.sectionTitle}>Account</Text>
        <Pressable style={styles.logoutButton} onPress={signOut}>
          <MaterialCommunityIcons name="logout" size={16} color={colors.danger} />
          <Text style={styles.logoutButtonText}>Log Out</Text>
        </Pressable>
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
    appbarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    backButton: {
      width: 28,
      height: 28,
      borderRadius: radii.pill,
      backgroundColor: 'rgba(255,255,255,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      fontFamily: fonts.headingSemiBold,
      fontWeight: '600',
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
    card: {
      backgroundColor: colors.peachCard,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: spacing.lg,
      alignItems: 'center',
    },
    appName: {
      fontFamily: fonts.heading,
      fontWeight: '700',
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
    logoutButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      borderWidth: 1.5,
      borderColor: colors.danger,
      borderRadius: radii.md,
      paddingVertical: spacing.md,
    },
    logoutButtonText: {
      color: colors.danger,
      fontWeight: '700',
      fontSize: 11.5,
    },
  });
