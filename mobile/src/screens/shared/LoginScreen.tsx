import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppScreen } from '../../components/AppScreen';
import { SplashLogo } from '../../components/BrandComponents';
import { ApiError } from '../../api/client';
import { requestOtp, verifyOtp } from '../../api/auth';
import { useAuth } from '../../context/AuthContext';
import { colors, radii, spacing } from '../../theme/theme';

type Step = 'phone' | 'otp';

// The Staff/Admin toggle mirrors the mockup for visual parity only — the
// backend's verifyOtp response is the actual source of truth for role, this
// selection has no effect on the request.
type RoleHint = 'staff' | 'admin';

export const LoginScreen: React.FC = () => {
  const { signIn } = useAuth();
  const [roleHint, setRoleHint] = useState<RoleHint>('staff');
  const [step, setStep] = useState<Step>('phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendOtp = async () => {
    setError(null);
    setLoading(true);
    try {
      await requestOtp(phoneNumber.trim());
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
      const { token, user } = await verifyOtp(phoneNumber.trim(), otp.trim());
      await signIn(token, user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppScreen backgroundColor={colors.peachBg}>
      <View style={styles.header}>
        <SplashLogo size="small" />
        <Text style={styles.headerSub}>Team Login</Text>
      </View>

      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.toggle, roleHint === 'staff' && styles.toggleActive]}
          onPress={() => setRoleHint('staff')}
        >
          <Text style={[styles.toggleText, roleHint === 'staff' && styles.toggleTextActive]}>Staff</Text>
        </Pressable>
        <Pressable
          style={[styles.toggle, roleHint === 'admin' && styles.toggleActive]}
          onPress={() => setRoleHint('admin')}
        >
          <Text style={[styles.toggleText, roleHint === 'admin' && styles.toggleTextActive]}>Admin</Text>
        </Pressable>
      </View>

      <Text style={styles.fieldLabel}>Phone Number</Text>
      <TextInput
        style={styles.field}
        placeholder="+91 98xxxxxx21"
        placeholderTextColor={colors.muted}
        value={phoneNumber}
        onChangeText={setPhoneNumber}
        keyboardType="phone-pad"
        editable={step === 'phone'}
      />

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
        disabled={loading || !phoneNumber || (step === 'otp' && !otp)}
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

const styles = StyleSheet.create({
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
    backgroundColor: colors.navyDeep,
  },
  toggleText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.navyDeep,
  },
  toggleTextActive: {
    color: colors.peachBg,
  },
  fieldLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    color: colors.navyText,
    marginBottom: spacing.xs,
  },
  field: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: 13,
    color: colors.navyText,
    marginBottom: spacing.sm,
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
