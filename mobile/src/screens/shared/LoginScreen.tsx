import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppScreen } from '../../components/AppScreen';
import { SplashLogo } from '../../components/BrandComponents';
import { ApiError } from '../../api/client';
import { requestOtp, verifyOtp } from '../../api/auth';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { ColorTokens, radii, spacing } from '../../theme/theme';

type Step = 'phone' | 'otp';

const COUNTRY_CODE = '+91';

export const LoginScreen: React.FC = () => {
  const { signIn } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [step, setStep] = useState<Step>('phone');
  const [localNumber, setLocalNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneNumber = `${COUNTRY_CODE}${localNumber.trim()}`;
  const isValidPhone = /^\d{10}$/.test(localNumber.trim());

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

  const handleChangeNumber = () => {
    setError(null);
    setOtp('');
    setStep('phone');
  };

  const handleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const { token, refreshToken, user } = await verifyOtp(phoneNumber, otp.trim());
      await signIn(token, refreshToken, user);
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

      <Text style={styles.fieldLabel}>Phone Number</Text>
      <View style={styles.phoneRow}>
        <View style={styles.countryCode}>
          <Text style={styles.countryCodeText}>{COUNTRY_CODE}</Text>
        </View>
        <View style={styles.phoneFieldWrap}>
          <TextInput
            testID="login-phone-input"
            style={[styles.phoneField, (step === 'otp' || isValidPhone) && styles.phoneFieldIconPadding]}
            placeholder="98xxxxxx21"
            placeholderTextColor={colors.muted}
            value={localNumber}
            onChangeText={setLocalNumber}
            keyboardType="phone-pad"
            editable={step === 'phone'}
            maxLength={10}
          />
          {step === 'otp' ? (
            <Pressable style={styles.phoneFieldIcon} onPress={handleChangeNumber} hitSlop={8}>
              <MaterialCommunityIcons name="pencil" size={16} color={colors.peachPrimary} />
            </Pressable>
          ) : (
            isValidPhone && (
              <View style={styles.phoneFieldIcon}>
                <MaterialCommunityIcons name="check-circle" size={16} color={colors.success} />
              </View>
            )
          )}
        </View>
      </View>

      {step === 'otp' && (
        <>
          <Text style={styles.fieldLabel}>OTP</Text>
          <TextInput
            testID="login-otp-input"
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
        testID="login-submit-button"
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
    phoneFieldWrap: {
      flex: 1,
      justifyContent: 'center',
    },
    phoneField: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      fontSize: 13,
      color: colors.navyText,
    },
    phoneFieldIconPadding: {
      paddingRight: spacing.xl,
    },
    phoneFieldIcon: {
      position: 'absolute',
      right: spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
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
