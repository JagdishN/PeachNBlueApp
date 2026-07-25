import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppScreen } from '../../components/AppScreen';
import { ThemeToggle } from '../../components/ThemeToggle';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fetchBranch, Branch } from '../../api/branches';
import { listOrders, Order, InternalStatus } from '../../api/orders';
import { getDisplayName } from '../../utils/displayName';
import { ColorTokens, radii, spacing } from '../../theme/theme';
import type { StaffStackParamList } from '../../navigation/StaffStack';

type Nav = NativeStackNavigationProp<StaffStackParamList, 'StaffHome'>;

const statusBadge = (status: InternalStatus): { label: string; style: 'overdue' | 'navy' | 'paid' } => {
  if (status === 'delivered') return { label: 'Delivered', style: 'paid' };
  if (status === 'cancelled') return { label: 'Cancelled', style: 'overdue' };
  return { label: 'Picked', style: 'navy' };
};

export const StaffHomeScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { state } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const user = state.status === 'signedIn' ? state.user : null;

  const [branch, setBranch] = useState<Branch | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const results = await listOrders({ branchId: user.branchId ?? undefined });
      setOrders(results);
    } catch (err) {
      setError('Could not load today\'s pickups.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user?.branchId) {
      fetchBranch(user.branchId).then(setBranch).catch(() => setBranch(null));
    }
  }, [user?.branchId]);

  useFocusEffect(
    useCallback(() => {
      loadOrders();
    }, [loadOrders])
  );

  return (
    <AppScreen scroll={false}>
      <View style={styles.appbar}>
        <View style={styles.appbarTopRow}>
          <View>
            <Text style={styles.title}>Today's Pickups</Text>
            <Text style={styles.subtitle}>
              {user?.fullName ? getDisplayName(user.fullName) : ''} · {orders.length} collected today
            </Text>
          </View>
          <View style={styles.appbarActions}>
            <ThemeToggle />
            <Pressable style={styles.settingsButton} onPress={() => navigation.navigate('Settings')}>
              <Text style={styles.settingsButtonText}>⚙</Text>
            </Pressable>
          </View>
        </View>
        {branch && (
          <View style={styles.branchChip}>
            <Text style={styles.branchChipText}>
              🏢 {branch.branchName} · {branch.phoneNumber}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.listArea}>
        {loading ? (
          <ActivityIndicator color={colors.peachPrimary} style={{ marginTop: spacing.xl }} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <ScrollView style={styles.listScroll} showsVerticalScrollIndicator={false}>
            {orders.map((order) => {
              const badge = statusBadge(order.internalStatus);
              return (
                <Pressable
                  key={order.id}
                  style={styles.card}
                  onPress={() => navigation.navigate('OrderStatus', { orderId: order.id })}
                >
                  <View style={styles.cardRow}>
                    <View>
                      <Text style={styles.cardTitle}>
                        {order.customer.locationLabel} · {order.customer.fullName}
                      </Text>
                      <Text style={styles.cardSub}>Order #{order.orderNumber}</Text>
                    </View>
                    <Text style={[styles.badge, styles[`badge_${badge.style}`]]}>{badge.label}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <Pressable style={styles.newOrderButton} onPress={() => navigation.navigate('NewOrderEntry')}>
          <Text style={styles.newOrderButtonText}>+ New Order (After Pickup)</Text>
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
    listArea: {
      flex: 1,
      padding: 14,
      // See AppScreen.tsx's `body` style comment — react-native-web's
      // min-height:auto floor, needed at every nested flex level for the
      // ScrollView below to actually clip+scroll on web.
      minHeight: 0,
    },
    listScroll: {
      flex: 1,
      minHeight: 0,
    },
    card: {
      backgroundColor: colors.peachCard,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: 13,
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
    badge: {
      fontSize: 8.5,
      fontWeight: '800',
      paddingVertical: 2,
      paddingHorizontal: 7,
      borderRadius: radii.pill,
      overflow: 'hidden',
    },
    badge_overdue: {
      backgroundColor: colors.warningBg,
      color: colors.warning,
    },
    badge_navy: {
      backgroundColor: colors.peachBg,
      color: colors.navyDeep,
    },
    badge_paid: {
      backgroundColor: colors.successBg,
      color: colors.success,
    },
    newOrderButton: {
      backgroundColor: colors.peachPrimary,
      borderRadius: radii.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.xs,
    },
    newOrderButtonText: {
      color: colors.white,
      fontWeight: '700',
      fontSize: 11.5,
    },
    error: {
      color: colors.danger,
      textAlign: 'center',
      marginTop: spacing.xl,
    },
  });
