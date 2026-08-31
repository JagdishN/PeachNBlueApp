import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { AppScreen } from '../../components/AppScreen';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import {
  getOrder,
  updateOrderStatus,
  recordOrderPayment,
  reviseOrderAmount,
  assignOrderStaff,
  Order,
  InternalStatus,
  PaymentMethod,
} from '../../api/orders';
import { fetchUsers, StaffUser } from '../../api/users';
import { getDisplayName } from '../../utils/displayName';
import { ApiError } from '../../api/client';
import { ColorTokens, fonts, radii, spacing } from '../../theme/theme';

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

// CLAUDE.md "Payment marking — real gap": the four confirmed payment modes,
// bundled into the same "mark Delivered" action for daily customers —
// monthly-billing customers are settled via the ledger instead (see
// orderService.ts's recordPayment, which 400s if attempted for one).
const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'net_banking', label: 'Net Banking' },
  { value: 'credit_card', label: 'Credit Card' },
];

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

  // Admin-only "reassign staff" control (CLAUDE.md "Staff-scoped order
  // visibility" edge case, resolved) — staff list for the order's own
  // branch, filtered to role 'staff' client-side since there's no
  // role-filtering query param on GET /users.
  const [branchStaff, setBranchStaff] = useState<StaffUser[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // CLAUDE.md "Payment marking — real gap" — only relevant for the
  // pending -> delivered transition on a daily-billing customer.
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod | null>(null);

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

  useEffect(() => {
    if (user?.role === 'admin' && order?.customer.branchId) {
      fetchUsers(order.customer.branchId)
        .then((users) => setBranchStaff(users.filter((u) => u.role === 'staff')))
        .catch(() => setBranchStaff([]));
    }
  }, [user?.role, order?.customer.branchId]);

  const handleAssignStaff = async (staffId: string) => {
    if (!order) return;
    setAssigning(true);
    setAssignError(null);
    try {
      const updated = await assignOrderStaff(order.id, staffId);
      setOrder(updated);
    } catch (err) {
      setAssignError(err instanceof ApiError ? err.message : 'Could not reassign this order.');
    } finally {
      setAssigning(false);
    }
  };

  // A daily-billing order needs a payment method picked before the
  // delivered transition fires; a monthly-billing order is settled via the
  // ledger instead (orderService.ts's billingMode branch), so there's
  // nothing to pick. Reads order.billingMode (this order's own snapshot
  // from creation time), NOT order.customer.billingMode — CLAUDE.md
  // "Monthly billing retroactivity — RESOLVED": the customer's current
  // setting can have changed since this order was created, and must not
  // retroactively change how this specific order is settled.
  const requiresPaymentMethod =
    order?.billingMode !== 'monthly_billing' &&
    STATUS_SEQUENCE[STATUS_SEQUENCE.indexOf(order?.internalStatus ?? 'picked_up') + 1] === 'delivered';

  const handleAdvanceStatus = async () => {
    if (!order) return;
    const currentIndex = STATUS_SEQUENCE.indexOf(order.internalStatus);
    const next = STATUS_SEQUENCE[currentIndex + 1];
    if (!next) return;

    if (next === 'delivered' && requiresPaymentMethod && !selectedPaymentMethod) {
      setError('Select how the customer paid before marking this order delivered.');
      return;
    }

    setUpdating(true);
    setError(null);
    try {
      // CLAUDE.md order workflow step 7: "verifies payment status and marks
      // the order both Delivered and Payment Received" — one bundled action,
      // not two separate screens. Payment recorded first so a failure there
      // doesn't leave the order marked delivered with no payment logged.
      if (next === 'delivered' && requiresPaymentMethod && selectedPaymentMethod) {
        await recordOrderPayment(order.id, selectedPaymentMethod);
      }
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

        {order.paymentStatus === 'paid' && (
          <Text style={styles.hint}>
            Payment received{order.paymentMethod ? ` · ${PAYMENT_METHOD_OPTIONS.find((o) => o.value === order.paymentMethod)?.label ?? order.paymentMethod}` : ''}
          </Text>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        {nextLabel === 'Delivered' && requiresPaymentMethod && (
          <View style={styles.paymentMethodBlock}>
            <Text style={styles.fieldLabel}>Payment Method</Text>
            <View style={styles.toggleRow}>
              {PAYMENT_METHOD_OPTIONS.map((option) => (
                <Pressable
                  key={option.value}
                  style={[styles.toggle, selectedPaymentMethod === option.value && styles.toggleActive]}
                  onPress={() => setSelectedPaymentMethod(option.value)}
                >
                  <Text
                    style={[styles.toggleText, selectedPaymentMethod === option.value && styles.toggleTextActive]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {nextLabel && (
          <Pressable style={[styles.advanceButton, updating && styles.advanceButtonDisabled]} onPress={handleAdvanceStatus} disabled={updating}>
            {updating ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.advanceButtonText}>
                {nextLabel === 'Delivered' ? 'Mark Delivered & Payment Received' : `Mark as ${nextLabel}`}
              </Text>
            )}
          </Pressable>
        )}

        {user?.role === 'admin' && (
          <View style={styles.revisionCard}>
            <Text style={styles.sectionTitle}>Assigned Staff</Text>

            <View style={styles.toggleRow}>
              {branchStaff.map((staffMember) => (
                <Pressable
                  key={staffMember.id}
                  style={[styles.toggle, order.staffId === staffMember.id && styles.toggleActive]}
                  onPress={() => handleAssignStaff(staffMember.id)}
                  disabled={assigning}
                >
                  <Text style={[styles.toggleText, order.staffId === staffMember.id && styles.toggleTextActive]}>
                    {getDisplayName(staffMember.fullName)}
                  </Text>
                </Pressable>
              ))}
            </View>
            {branchStaff.length === 0 && <Text style={styles.hint}>No staff accounts found for this branch.</Text>}
            {assigning && <ActivityIndicator color={colors.peachPrimary} />}
            {assignError && <Text style={styles.error}>{assignError}</Text>}
          </View>
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
      fontFamily: fonts.headingSemiBold,
      fontWeight: '600',
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
    paymentMethodBlock: {
      marginTop: spacing.sm,
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
    toggleRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginBottom: spacing.xs,
    },
    toggle: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.sm,
      borderWidth: 1.5,
      borderColor: colors.navyDeep,
    },
    toggleActive: {
      backgroundColor: colors.chrome,
      borderColor: colors.chrome,
    },
    toggleText: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.navyDeep,
    },
    toggleTextActive: {
      color: colors.cream,
    },
    hint: {
      fontSize: 9.5,
      color: colors.muted,
    },
  });
