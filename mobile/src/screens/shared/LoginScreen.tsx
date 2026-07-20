import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppScreen } from '../../components/AppScreen';
import { SplashLogo } from '../../components/BrandComponents';
import { ApiError } from '../../api/client';
import { requestOtp, verifyOtp } from '../../api/auth';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { ColorTokens, radii, spacing } from '../../theme/theme';

type Step = 'phone' | 'otp';

// The Staff/Admin toggle mirrors the mockup for visual parity only — the
// backend's verifyOtp response is the actual source of truth for role, this
// selection has no effect on the request.
type RoleHint = 'staff' | 'admin';

const COUNTRY_CODE = '+91';

export const LoginScreen: React.FC = () => {
  const { signIn } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [roleHint, setRoleHint] = useState<RoleHint>('admin');
  const [step, setStep] = useState<Step>('phone');
  const [localNumber, setLocalNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneNumber = `${COUNTRY_CODE}${localNumber.trim()}`;

  const handleSendOtp = async () => {
    setError(null);
    setLoading(true);
    try {
      await requestOtp(phoneNumber);
      setStep('otp');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send OTP. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const { token, user } = await verifyOtp(phoneNumber, otp.trim());
      await signIn(token, user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppScreen>
      <View style={styles.header}>
        <SplashLogo size="small" />
        <Text style={styles.headerSub}>Team Login</Text>
      </View>

      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.toggle, roleHint === 'admin' && styles.toggleActive]}
          onPress={() => setRoleHint('admin')}
        >
          <Text style={[styles.toggleText, roleHint === 'admin' && styles.toggleTextActive]}>Admin</Text>
        </Pressable>
        <Pressable
          style={[styles.toggle, roleHint === 'staff' && styles.toggleActive]}
          onPress={() => setRoleHint('staff')}
        >
          <Text style={[styles.toggleText, roleHint === 'staff' && styles.toggleTextActive]}>Staff</Text>
        </Pressable>
      </View>

      <Text style={styles.fieldLabel}>Phone Number</Text>
      <View style={styles.phoneRow}>
        <View style={styles.countryCode}>
          <Text style={styles.countryCodeText}>{COUNTRY_CODE}</Text>
        </View>
        <TextInput
          style={styles.phoneField}
          placeholder="98xxxxxx21"
          placeholderTextColor={colors.muted}
          value={localNumber}
          onChangeText={setLocalNumber}
          keyboardType="phone-pad"
          editable={step === 'phone'}
        />
      </View>

      {step === 'otp' && (
        <>
          <Text style={styles.fieldLabel}>OTP</Text>
          <TextInput
            style={styles.field}
            placeholder="• • • • • •"
            placeholderTextColor={colors.muted}
            value={otp}
            onChangeText={setOtp}
            keyboardType="number-pad"
            maxLength={6}
          />
        </>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={step === 'phone' ? handleSendOtp : handleSignIn}
        disabled={loading || !localNumber || (step === 'otp' && !otp)}
      >
        {loading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.buttonText}>{step === 'phone' ? 'Send OTP' : 'Sign In'}</Text>
        )}
      </Pressable>
    </AppScreen>
  );
};

const createStyles = (colors: ColorTokens) =>
  StyleSheet.create({
    header: {
      alignItems: 'center',
      marginVertical: spacing.lg,
    },
    headerSub: {
      fontSize: 9.5,
      fontWeight: '700',
      color: colors.warning,
      letterSpacing: 2,
      textTransform: 'uppercase',
      marginTop: spacing.xs,
    },
    toggleRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.lg,
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
    fieldLabel: {
      fontSize: 9.5,
      fontWeight: '700',
      color: colors.navyText,
      marginBottom: spacing.xs,
    },
    field: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      fontSize: 13,
      color: colors.navyText,
      marginBottom: spacing.sm,
    },
    phoneRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    countryCode: {
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      paddingHorizontal: spacing.md,
    },
    countryCodeText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.navyText,
    },
    phoneField: {
      flex: 1,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      fontSize: 13,
      color: colors.navyText,
    },
    error: {
      color: colors.danger,
      fontSize: 11,
      marginBottom: spacing.sm,
    },
    button: {
      backgroundColor: colors.peachPrimary,
      borderRadius: radii.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.xs,
    },
    buttonDisabled: {
      opacity: 0.7,
    },
    buttonText: {
      color: colors.white,
      fontWeight: '700',
      fontSize: 13,
    },
  });
