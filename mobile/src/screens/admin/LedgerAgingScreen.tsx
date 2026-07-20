import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AppScreen } from '../../components/AppScreen';
import { PriceChip } from '../../components/PriceChip';
import { useTheme } from '../../context/ThemeContext';
import { fetchAgingReport, sendReminder, AgingRow } from '../../api/ledger';
import { ColorTokens, radii, spacing } from '../../theme/theme';

export const LedgerAgingScreen: React.FC = () => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [rows, setRows] = useState<AgingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reminding, setReminding] = useState<string | null>(null);
  const [sentFor, setSentFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchAgingReport());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleRemind = async (customerId: string) => {
    setReminding(customerId);
    setSentFor(null);
    try {
      await sendReminder(customerId);
      setSentFor(customerId);
    } finally {
      setReminding(null);
    }
  };

  return (
    <AppScreen scroll={false}>
      <View style={styles.appbar}>
        <Text style={styles.title}>Monthly Billing Ledger</Text>
        <Text style={styles.subtitle}>Sorted by days overdue</Text>
      </View>

      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator color={colors.peachPrimary} style={{ marginTop: spacing.xl }} />
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>No monthly-billing customers with an outstanding balance.</Text>
        ) : (
          rows.map((row) => (
            <View key={row.customerId} style={styles.card}>
              <View style={styles.cardRow}>
                <View>
                  <Text style={styles.cardTitle}>
                    {row.locationLabel} · {row.customerName}
                  </Text>
                  <Text style={styles.cardSub}>{row.daysSinceLastCharge ?? 0} days overdue</Text>
                </View>
                <PriceChip amount={row.outstandingBalance} />
              </View>
              <Pressable
                style={[styles.remindButton, reminding === row.customerId && styles.remindButtonDisabled]}
                onPress={() => handleRemind(row.customerId)}
                disabled={reminding === row.customerId}
              >
                {reminding === row.customerId ? (
                  <ActivityIndicator color={colors.navyDeep} />
                ) : (
                  <Text style={styles.remindButtonText}>
                    {sentFor === row.customerId ? 'Reminder Sent ✓' : 'Send WhatsApp Reminder'}
                  </Text>
                )}
              </Pressable>
            </View>
          ))
        )}
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
    subtitle: {
      fontSize: 10,
      color: '#C8A67B',
      marginTop: 2,
    },
    body: {
      flex: 1,
      padding: 14,
    },
    card: {
      backgroundColor: colors.peachCard,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: 12,
      marginBottom: 10,
    },
    cardRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    cardTitle: {
      fontSize: 12.5,
      fontWeight: '700',
      color: colors.navyText,
    },
    cardSub: {
      fontSize: 10.5,
      color: colors.muted,
      marginTop: 2,
    },
    remindButton: {
      borderWidth: 1.5,
      borderColor: colors.navyDeep,
      borderRadius: radii.md,
      paddingVertical: spacing.sm,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    remindButtonDisabled: {
      opacity: 0.7,
    },
    remindButtonText: {
      color: colors.navyDeep,
      fontWeight: '700',
      fontSize: 10.5,
    },
    empty: {
      fontSize: 11,
      color: colors.muted,
      marginTop: spacing.lg,
      textAlign: 'center',
    },
  });
