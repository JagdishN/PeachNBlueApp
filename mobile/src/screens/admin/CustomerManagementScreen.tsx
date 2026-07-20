import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AppScreen } from '../../components/AppScreen';
import { NivenxaFooter } from '../../components/BrandComponents';
import { Tag } from '../../components/Tag';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { ApiError } from '../../api/client';
import {
  fetchCustomers,
  updateCustomerBillingMode,
  updateCustomerDiscountEnabled,
  updateCustomerDiscountPercent,
  BillingMode,
  Customer,
} from '../../api/customers';
import { ColorTokens, radii, spacing } from '../../theme/theme';

const BILLING_MODE_LABEL: Record<BillingMode, string> = {
  daily: 'Daily',
  monthly_billing: 'Monthly Billing',
};

// Admin-only (CLAUDE.md "Known gaps" — billingMode/discountEnabled/
// discountPercent were only reachable via raw API calls before this
// screen). Not reachable from the staff navigation stack; staff continue
// to see billingMode read-only wherever they already do (e.g. at
// delivery) via the existing, unrelated order-detail views.
export const CustomerManagementScreen: React.FC = () => {
  const { state } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const user = state.status === 'signedIn' ? state.user : null;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [billingMode, setBillingMode] = useState<BillingMode>('daily');
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountPercentInput, setDiscountPercentInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Branch-scoped admins get their own branch back regardless of this
      // param (enforced server-side) — matches the pattern already used by
      // AdminDashboardScreen's listOrders({ branchId: user?.branchId }) call.
      setCustomers(await fetchCustomers(user?.branchId ?? undefined));
    } finally {
      setLoading(false);
    }
  }, [user?.branchId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Grouped by branch (requirement: "filterable/grouped by branch") — an
  // unscoped admin sees every branch's customers sectioned; a branch-scoped
  // admin's list is already narrowed to one branch server-side, so this
  // just produces a single section for them.
  const sections = useMemo(() => {
    const byBranch = new Map<string, { branchName: string; customers: Customer[] }>();
    for (const customer of customers) {
      if (!byBranch.has(customer.branchId)) {
        byBranch.set(customer.branchId, { branchName: customer.branch.branchName, customers: [] });
      }
      byBranch.get(customer.branchId)!.customers.push(customer);
    }
    return Array.from(byBranch.values());
  }, [customers]);

  const openEdit = (customer: Customer) => {
    setEditing(customer);
    setBillingMode(customer.billingMode);
    setDiscountEnabled(customer.discountEnabled);
    setDiscountPercentInput(customer.discountPercent ?? '0');
    setError(null);
  };

  const handleSave = async () => {
    if (!editing) return;

    setSaving(true);
    setError(null);
    try {
      if (billingMode !== editing.billingMode) {
        await updateCustomerBillingMode(editing.id, billingMode);
      }
      if (discountEnabled !== editing.discountEnabled) {
        await updateCustomerDiscountEnabled(editing.id, discountEnabled);
      }
      // Only ever sent while the toggle is on — the field is non-editable
      // while off, and turning it off never clears the stored percentage
      // (CLAUDE.md "Monthly billing + discount: now live"), so there's
      // nothing to save for it in that state.
      if (discountEnabled) {
        const newPercent = Number(discountPercentInput);
        const storedPercent = Number(editing.discountPercent ?? 0);
        if (Number.isNaN(newPercent) || newPercent < 0 || newPercent > 100) {
          setError('Discount percent must be a number between 0 and 100.');
          setSaving(false);
          return;
        }
        if (newPercent !== storedPercent) {
          await updateCustomerDiscountPercent(editing.id, newPercent);
        }
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this customer.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppScreen scroll={false}>
      <View style={styles.appbar}>
        <Text style={styles.title}>Customers</Text>
        <Text style={styles.subtitle}>{customers.length} total · Billing & discount, admin-only</Text>
      </View>

      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator color={colors.peachPrimary} style={{ marginTop: spacing.xl }} />
        ) : customers.length === 0 ? (
          <Text style={styles.empty}>No customers yet.</Text>
        ) : (
          sections.map((section) => (
            <View key={section.branchName}>
              <Text style={styles.sectionHeader}>{section.branchName}</Text>
              {section.customers.map((customer) => (
                <Pressable key={customer.id} style={styles.card} onPress={() => openEdit(customer)}>
                  <View style={styles.cardRow}>
                    <View style={styles.nameRow}>
                      <Text style={styles.customerName}>{customer.fullName}</Text>
                      {customer.billingMode === 'monthly_billing' && (
                        <Tag label="Monthly" bg={colors.warningBg} color={colors.warning} />
                      )}
                      {customer.discountEnabled && <Tag label="Discount ON" bg={colors.successBg} color={colors.success} />}
                    </View>
                  </View>
                  <Text style={styles.cardSub}>
                    {customer.locationLabel} · {customer.phoneNumber}
                  </Text>
                </Pressable>
              ))}
            </View>
          ))
        )}
      </View>

      <Modal visible={editing !== null} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editing?.fullName}</Text>
            <Text style={styles.modalSubtitle}>
              {editing?.locationLabel} · {editing?.branch.branchName}
            </Text>

            <Text style={styles.fieldLabel}>Billing Mode</Text>
            <View style={styles.toggleRow}>
              {(['daily', 'monthly_billing'] as BillingMode[]).map((mode) => (
                <Pressable
                  key={mode}
                  style={[styles.toggle, billingMode === mode && styles.toggleActive]}
                  onPress={() => setBillingMode(mode)}
                >
                  <Text style={[styles.toggleText, billingMode === mode && styles.toggleTextActive]}>
                    {BILLING_MODE_LABEL[mode]}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Discount</Text>
            <View style={styles.toggleRow}>
              {[false, true].map((value) => (
                <Pressable
                  key={String(value)}
                  style={[styles.toggle, discountEnabled === value && styles.toggleActive]}
                  onPress={() => setDiscountEnabled(value)}
                >
                  <Text style={[styles.toggleText, discountEnabled === value && styles.toggleTextActive]}>
                    {value ? 'On' : 'Off'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Discount Percent</Text>
            <TextInput
              style={[styles.field, !discountEnabled && styles.fieldDisabled]}
              value={discountPercentInput}
              onChangeText={setDiscountPercentInput}
              keyboardType="decimal-pad"
              editable={discountEnabled}
              placeholder="0"
              placeholderTextColor={colors.muted}
            />
            {!discountEnabled && (
              <Text style={styles.hint}>Stored percentage is kept even while the discount is off.</Text>
            )}

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveButtonText}>Save</Text>}
            </Pressable>

            <Pressable style={styles.cancelButton} onPress={() => setEditing(null)}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
          {/* Modal renders in its own native layer above AppScreen's footer,
              so it needs its own — CLAUDE.md's footer requirement is not
              screen-scoped, it's "every screen", including this sheet. */}
          <NivenxaFooter />
        </View>
      </Modal>
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
    sectionHeader: {
      fontSize: 10.5,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      color: colors.muted,
      marginBottom: spacing.xs,
      marginTop: spacing.sm,
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
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      flexShrink: 1,
    },
    customerName: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.navyText,
    },
    cardSub: {
      fontSize: 10.5,
      color: colors.muted,
      marginTop: 3,
    },
    empty: {
      fontSize: 11,
      color: colors.muted,
      marginTop: spacing.lg,
      textAlign: 'center',
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(14,33,66,0.4)',
      justifyContent: 'flex-end',
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radii.lg,
      borderTopRightRadius: radii.lg,
      padding: spacing.lg,
      maxHeight: '85%',
    },
    modalTitle: {
      fontFamily: 'Lora_600SemiBold',
      fontSize: 15,
      color: colors.navyDeep,
    },
    modalSubtitle: {
      fontSize: 10.5,
      color: colors.muted,
      marginBottom: spacing.md,
    },
    fieldLabel: {
      fontSize: 9.5,
      fontWeight: '700',
      color: colors.navyText,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    toggleRow: {
      flexDirection: 'row',
      gap: spacing.xs,
      marginBottom: spacing.sm,
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
    field: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      fontSize: 13,
      color: colors.navyText,
      marginBottom: spacing.xs,
    },
    fieldDisabled: {
      opacity: 0.5,
    },
    hint: {
      fontSize: 9.5,
      color: colors.muted,
      marginBottom: spacing.sm,
    },
    error: {
      color: colors.danger,
      fontSize: 11,
      marginBottom: spacing.sm,
    },
    saveButton: {
      backgroundColor: colors.peachPrimary,
      borderRadius: radii.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.xs,
    },
    saveButtonDisabled: {
      opacity: 0.7,
    },
    saveButtonText: {
      color: colors.white,
      fontWeight: '700',
      fontSize: 12,
    },
    cancelButton: {
      alignItems: 'center',
      paddingVertical: spacing.sm,
    },
    cancelButtonText: {
      color: colors.muted,
      fontSize: 11,
    },
  });
