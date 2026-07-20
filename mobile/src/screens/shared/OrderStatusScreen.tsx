import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { AppScreen } from '../../components/AppScreen';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { getOrder, updateOrderStatus, reviseOrderAmount, Order, InternalStatus } from '../../api/orders';
import { ApiError } from '../../api/client';
import { ColorTokens, radii, spacing } from '../../theme/theme';

type OrderStatusRoute = RouteProp<{ OrderStatus: { orderId: string } }, 'OrderStatus'>;

const STATUS_SEQUENCE: InternalStatus[] = ['picked_up', 'washing', 'ironing', 'ready', 'out_for_delivery', 'delivered'];
const STAGE_LABELS = ['Picked', 'Processing', 'Ready', 'Delivered'];

// Maps the 6-value internal_status enum onto the mockup's 4-stage track.
const stageIndexForStatus = (status: InternalStatus): number => {
  if (status === 'picked_up') return 0;
  if (status === 'washing' || status === 'ironing') return 1;
  if (status === 'ready' || status === 'out_for_delivery') return 2;
  return 3; // delivered (or cancelled, shown as complete/terminal)
};

const nextStatusLabel: Partial<Record<InternalStatus, string>> = {
  picked_up: 'Washing',
  washing: 'Ironing',
  ironing: 'Ready',
  ready: 'Out for Delivery',
  out_for_delivery: 'Delivered',
};

// Shared by both stacks. The admin-only amount-revision card (Section D)
// renders below the status track when user.role === 'admin' — staff never
// see it, keeping "staff-visible parts only" true without a second screen.
export const OrderStatusScreen: React.FC = () => {
  const route = useRoute<OrderStatusRoute>();
  const { state } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const user = state.status === 'signedIn' ? state.user : null;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [revisedAmount, setRevisedAmount] = useState('');
  const [reason, setReason] = useState('');
  const [revising, setRevising] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);

  const loadOrder = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getOrder(route.params.orderId);
      setOrder(result);
      setRevisedAmount(result.finalAmount);
    } catch (err) {
      setError('Could not load this order.');
    } finally {
      setLoading(false);
    }
  }, [route.params.orderId]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  const handleAdvanceStatus = async () => {
    if (!order) return;
    const currentIndex = STATUS_SEQUENCE.indexOf(order.internalStatus);
    const next = STATUS_SEQUENCE[currentIndex + 1];
    if (!next) return;

    setUpdating(true);
    setError(null);
    try {
      const updated = await updateOrderStatus(order.id, next);
      setOrder(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update status.');
    } finally {
      setUpdating(false);
    }
  };

  const handleRevise = async () => {
    if (!order) return;
    if (!revisedAmount || !reason) {
      setRevisionError('Revised amount and reason are both required.');
      return;
    }

    setRevising(true);
    setRevisionError(null);
    try {
      const updated = await reviseOrderAmount(order.id, Number(revisedAmount), reason);
      setOrder(updated);
      setReason('');
    } catch (err) {
      setRevisionError(err instanceof ApiError ? err.message : 'Could not save this revision.');
    } finally {
      setRevising(false);
    }
  };

  if (loading) {
    return (
      <AppScreen>
        <ActivityIndicator color={colors.peachPrimary} style={{ marginTop: spacing.xxl }} />
      </AppScreen>
    );
  }

  if (!order) {
    return (
      <AppScreen>
        <Text style={styles.error}>{error ?? 'Order not found.'}</Text>
      </AppScreen>
    );
  }

  const stageIndex = stageIndexForStatus(order.internalStatus);
  const nextLabel = nextStatusLabel[order.internalStatus];

  return (
    <AppScreen>
      <View style={styles.appbar}>
        <Text style={styles.title}>Order #{order.orderNumber}</Text>
        <Text style={styles.subtitle}>
          {order.customer.locationLabel} · {order.customer.fullName}
        </Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.sectionTitle}>Internal Progress</Text>

        <View style={styles.track}>
          {STAGE_LABELS.map((_, i) => (
            <React.Fragment key={i}>
              <View style={[styles.dot, i < stageIndex && styles.dotDone, i === stageIndex && styles.dotNow]} />
              {i < STAGE_LABELS.length - 1 && <View style={[styles.line, i < stageIndex && styles.lineDone]} />}
            </React.Fragment>
          ))}
        </View>
        <View style={styles.trackLabels}>
          {STAGE_LABELS.map((label) => (
            <Text key={label} style={styles.trackLabel}>
              {label}
            </Text>
          ))}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        {nextLabel && (
          <Pressable style={[styles.advanceButton, updating && styles.advanceButtonDisabled]} onPress={handleAdvanceStatus} disabled={updating}>
            {updating ? <ActivityIndicator color={colors.white} /> : <Text style={styles.advanceButtonText}>Mark as {nextLabel}</Text>}
          </Pressable>
        )}

        {user?.role === 'admin' && order.internalStatus !== 'delivered' && (
          <View style={styles.revisionCard}>
            <Text style={styles.sectionTitle}>Revise Final Amount</Text>

            <Text style={styles.fieldLabel}>Estimated (at pickup)</Text>
            <Text style={styles.readOnlyField}>₹{order.estimatedAmount}</Text>

            <Text style={styles.fieldLabel}>Revised Amount</Text>
            <TextInput
              style={styles.field}
              value={revisedAmount}
              onChangeText={setRevisedAmount}
              keyboardType="decimal-pad"
            />

            <Text style={styles.fieldLabel}>Reason (sent to customer)</Text>
            <TextInput
              style={styles.field}
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. Saree needed stain treatment"
              placeholderTextColor={colors.muted}
              multiline
            />

            {revisionError && <Text style={styles.error}>{revisionError}</Text>}

            <Pressable style={[styles.advanceButton, revising && styles.advanceButtonDisabled]} onPress={handleRevise} disabled={revising}>
              {revising ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.advanceButtonText}>Save & Notify via WhatsApp</Text>
              )}
            </Pressable>
          </View>
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
      marginHorizontal: -14,
      marginTop: -14,
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
      paddingTop: spacing.lg,
    },
    sectionTitle: {
      fontSize: 12.5,
      fontWeight: '700',
      color: colors.navyText,
      marginBottom: spacing.sm,
    },
    track: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
    },
    dot: {
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: colors.border,
    },
    dotDone: {
      backgroundColor: colors.success,
    },
    dotNow: {
      backgroundColor: colors.peachPrimary,
    },
    line: {
      flex: 1,
      height: 2,
      backgroundColor: colors.border,
    },
    lineDone: {
      backgroundColor: colors.success,
    },
    trackLabels: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.lg,
    },
    trackLabel: {
      fontSize: 7.5,
      fontWeight: '700',
      color: colors.muted,
    },
    error: {
      color: colors.danger,
      fontSize: 11,
      marginBottom: spacing.sm,
    },
    advanceButton: {
      backgroundColor: colors.peachPrimary,
      borderRadius: radii.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.xs,
    },
    advanceButtonDisabled: {
      opacity: 0.7,
    },
    advanceButtonText: {
      color: colors.white,
      fontWeight: '700',
      fontSize: 11.5,
    },
    revisionCard: {
      backgroundColor: colors.peachCard,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: 13,
      marginTop: spacing.lg,
    },
    fieldLabel: {
      fontSize: 9.5,
      fontWeight: '700',
      color: colors.navyText,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    readOnlyField: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      fontSize: 13,
      color: colors.muted,
    },
    field: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      fontSize: 13,
      color: colors.navyDeep,
      fontWeight: '700',
    },
  });
