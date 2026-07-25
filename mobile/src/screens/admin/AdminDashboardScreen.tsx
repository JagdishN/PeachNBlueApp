import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppScreen } from '../../components/AppScreen';
import { PriceChip } from '../../components/PriceChip';
import { ThemeToggle } from '../../components/ThemeToggle';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fetchBranch, Branch } from '../../api/branches';
import { fetchSummary, ReportSummary } from '../../api/reports';
import { fetchAgingReport, AgingRow } from '../../api/ledger';
import { listOrders, Order } from '../../api/orders';
import { ColorTokens, radii, spacing } from '../../theme/theme';
import type { AdminStackParamList } from '../../navigation/AdminStack';

type Nav = NativeStackNavigationProp<AdminStackParamList>;

const ACTIVE_STATUSES = ['picked_up', 'washing', 'ironing', 'ready', 'out_for_delivery'];

const todayLabel = () =>
  new Date().toLocaleDateString('en-IN', { weekday: undefined, day: '2-digit', month: 'short', year: 'numeric' });

export const AdminDashboardScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { state } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const user = state.status === 'signedIn' ? state.user : null;

  const [branch, setBranch] = useState<Branch | null>(null);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [needsAttention, setNeedsAttention] = useState<AgingRow[]>([]);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.branchId) {
      fetchBranch(user.branchId).then(setBranch).catch(() => setBranch(null));
    }
  }, [user?.branchId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryResult, agingResult, orders] = await Promise.all([
        fetchSummary(),
        fetchAgingReport(),
        listOrders({ branchId: user?.branchId ?? undefined }),
      ]);
      setSummary(summaryResult);
      setNeedsAttention(agingResult.slice(0, 3));
      setActiveOrders(orders.filter((o) => ACTIVE_STATUSES.includes(o.internalStatus)).slice(0, 3));
    } finally {
      setLoading(false);
    }
  }, [user?.branchId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <AppScreen scroll={false}>
      <View style={styles.appbar}>
        <View style={styles.appbarTopRow}>
          <View>
            <Text style={styles.title}>Overview</Text>
            <Text style={styles.subtitle}>Today, {todayLabel()}</Text>
          </View>
          <View style={styles.appbarActions}>
            <ThemeToggle />
            <Pressable style={styles.settingsButton} onPress={() => navigation.navigate('Settings')}>
              <Text style={styles.settingsButtonText}>⚙</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.branchChip}>
          <Text style={styles.branchChipText}>{user?.branchId ? branch?.branchName ?? '…' : 'All Branches ▾'}</Text>
        </View>
      </View>

      <View style={styles.body}>
        {loading || !summary ? (
          <ActivityIndicator color={colors.peachPrimary} style={{ marginTop: spacing.xl }} />
        ) : (
          <>
            <View style={styles.statGrid}>
              <StatCard num={summary.ordersToday} label="Orders Today" styles={styles} />
              <StatCard num={`₹${summary.revenueToday}`} label="Revenue Today" styles={styles} />
              <StatCard num={`₹${summary.outstandingDues}`} label="Outstanding Dues" styles={styles} />
              <StatCard num={summary.branchesActive} label="Branches Active" styles={styles} />
            </View>

            <Text style={styles.sectionTitle}>Needs Attention</Text>
            {needsAttention.length === 0 && activeOrders.length === 0 ? (
              <Text style={styles.empty}>Nothing needs attention right now.</Text>
            ) : (
              <>
                {needsAttention.map((row) => (
                  <View key={row.customerId} style={styles.attentionCard}>
                    <Text style={styles.attentionText}>
                      {row.locationLabel} overdue {row.daysSinceLastCharge ?? 0} days
                    </Text>
                    <PriceChip amount={row.outstandingBalance} />
                  </View>
                ))}
                {activeOrders.map((order) => (
                  <Pressable
                    key={order.id}
                    style={styles.attentionCard}
                    onPress={() => navigation.navigate('OrderStatus', { orderId: order.id })}
                  >
                    <Text style={styles.attentionText}>Order #{order.orderNumber} in progress</Text>
                    <Text style={styles.reviewChip}>Review</Text>
                  </Pressable>
                ))}
              </>
            )}
          </>
        )}
      </View>
    </AppScreen>
  );
};

const StatCard: React.FC<{ num: number | string; label: string; styles: ReturnType<typeof createStyles> }> = ({
  num,
  label,
  styles,
}) => (
  <View style={styles.statCard}>
    <Text style={styles.statNum}>{num}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const createStyles = (colors: ColorTokens) =>
  StyleSheet.create({
    appbar: {
      backgroundColor: colors.chrome,
      padding: spacing.lg,
      paddingBottom: 14,
    },
    appbarTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    appbarActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    settingsButton: {
      width: 28,
      height: 28,
      borderRadius: radii.pill,
      backgroundColor: 'rgba(255,255,255,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    settingsButtonText: {
      fontSize: 14,
      color: colors.cream,
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
    branchChip: {
      alignSelf: 'flex-start',
      backgroundColor: 'rgba(255,255,255,0.12)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.25)',
      borderRadius: radii.pill,
      paddingVertical: 3,
      paddingHorizontal: 9,
      marginTop: spacing.sm,
    },
    branchChipText: {
      fontSize: 8.5,
      fontWeight: '700',
      color: colors.cream,
    },
    body: {
      flex: 1,
      padding: 14,
    },
    statGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    statCard: {
      width: '48%',
      backgroundColor: colors.peachCard,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: 11,
    },
    statNum: {
      fontFamily: 'Lora_700Bold',
      fontSize: 18,
      color: colors.navyDeep,
    },
    statLabel: {
      fontSize: 9,
      color: colors.muted,
      fontWeight: '600',
      marginTop: 2,
    },
    sectionTitle: {
      fontSize: 12.5,
      fontWeight: '700',
      color: colors.navyText,
      marginVertical: spacing.sm,
    },
    attentionCard: {
      backgroundColor: colors.peachCard,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: 12,
      marginBottom: spacing.sm,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    attentionText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.navyText,
    },
    reviewChip: {
      backgroundColor: colors.peachPrimary,
      color: colors.white,
      fontWeight: '800',
      fontSize: 10.5,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: radii.pill,
      overflow: 'hidden',
    },
    empty: {
      fontSize: 11,
      color: colors.muted,
    },
  });
