import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AppScreen } from '../../components/AppScreen';
import { NivenxaFooter } from '../../components/BrandComponents';
import { Tag } from '../../components/Tag';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { ApiError } from '../../api/client';
import { fetchUsers, createUser, StaffUser, UserRole } from '../../api/users';
import { fetchBranches, Branch } from '../../api/branches';
import { ColorTokens, radii, spacing } from '../../theme/theme';

const UNSCOPED_KEY = '__unscoped__';

// Admin-only (CLAUDE.md "Staff/Admin account management" — accounts were
// only ever created by directly seeding the DB; this is the first in-app
// path). Not reachable from the staff navigation stack. List-only for
// existing accounts (no edit/deactivate here — not asked for); the modal is
// create-only.
export const StaffManagementScreen: React.FC = () => {
  const { state } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const user = state.status === 'signedIn' ? state.user : null;

  const [users, setUsers] = useState<StaffUser[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [role, setRole] = useState<UserRole>('staff');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Branch-scoped admins get their own branch back regardless of this
      // param (enforced server-side) — same pattern as CustomerManagementScreen.
      const [fetchedUsers, fetchedBranches] = await Promise.all([
        fetchUsers(user?.branchId ?? undefined),
        fetchBranches(),
      ]);
      setUsers(fetchedUsers);
      setBranches(fetchedBranches);
    } finally {
      setLoading(false);
    }
  }, [user?.branchId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const branchNameById = useMemo(() => new Map(branches.map((b) => [b.id, b.branchName])), [branches]);

  // Grouped by branch, with an "All Branches" section for unscoped admins
  // (branchId null) — mirrors CustomerManagementScreen's branch grouping.
  const sections = useMemo(() => {
    const byBranch = new Map<string, { label: string; users: StaffUser[] }>();
    for (const u of users) {
      const key = u.branchId ?? UNSCOPED_KEY;
      if (!byBranch.has(key)) {
        byBranch.set(key, { label: u.branchId ? branchNameById.get(u.branchId) ?? 'Unknown Branch' : 'All Branches (Unscoped Admin)', users: [] });
      }
      byBranch.get(key)!.users.push(u);
    }
    return Array.from(byBranch.values());
  }, [users, branchNameById]);

  const openNew = () => {
    setFullName('');
    setPhoneNumber('');
    setRole('staff');
    setBranchId(user?.branchId ?? branches[0]?.id ?? null);
    setError(null);
    setCreating(true);
  };

  const handleCreate = async () => {
    if (!fullName || !phoneNumber) {
      setError('Name and phone number are required.');
      return;
    }
    if (role === 'staff' && !branchId) {
      setError('A branch is required for a staff account.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createUser({ fullName, phoneNumber, role, branchId: role === 'staff' ? branchId : branchId });
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create this account.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppScreen scroll={false}>
      <View style={styles.appbar}>
        <Text style={styles.title}>Staff & Admin Accounts</Text>
        <Text style={styles.subtitle}>{users.length} total · Admin-only, no passwords (OTP login)</Text>
      </View>

      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator color={colors.peachPrimary} style={{ marginTop: spacing.xl }} />
        ) : users.length === 0 ? (
          <Text style={styles.empty}>No staff or admin accounts yet.</Text>
        ) : (
          sections.map((section) => (
            <View key={section.label}>
              <Text style={styles.sectionHeader}>{section.label}</Text>
              {section.users.map((u) => (
                <View key={u.id} style={styles.card}>
                  <View style={styles.cardRow}>
                    <View style={styles.nameRow}>
                      <Text style={styles.userName}>{u.fullName}</Text>
                      <Tag
                        label={u.role === 'admin' ? 'Admin' : 'Staff'}
                        bg={u.role === 'admin' ? colors.warningBg : colors.successBg}
                        color={u.role === 'admin' ? colors.warning : colors.success}
                      />
                      {!u.isActive && <Tag label="Inactive" bg={colors.border} color={colors.muted} />}
                    </View>
                  </View>
                  <Text style={styles.cardSub}>{u.phoneNumber}</Text>
                </View>
              ))}
            </View>
          ))
        )}

        <Pressable style={styles.addButton} onPress={openNew}>
          <Text style={styles.addButtonText}>+ Add Staff / Admin</Text>
        </Pressable>
      </View>

      <Modal visible={creating} transparent animationType="slide" onRequestClose={() => setCreating(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Staff / Admin</Text>

            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.field}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Ramesh Kumar"
              placeholderTextColor={colors.muted}
            />

            <Text style={styles.fieldLabel}>Phone Number</Text>
            <TextInput
              style={styles.field}
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              placeholder="+919xxxxxxxxx"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
            />

            <Text style={styles.fieldLabel}>Role</Text>
            <View style={styles.toggleRow}>
              {(['staff', 'admin'] as UserRole[]).map((r) => (
                <Pressable key={r} style={[styles.toggle, role === r && styles.toggleActive]} onPress={() => setRole(r)}>
                  <Text style={[styles.toggleText, role === r && styles.toggleTextActive]}>
                    {r === 'admin' ? 'Admin' : 'Staff'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>
              Branch {role === 'admin' && <Text style={styles.hintInline}>(optional — unscoped admin sees all)</Text>}
            </Text>
            <View style={styles.branchChipRow}>
              {role === 'admin' && (
                <Pressable
                  style={[styles.branchChip, branchId === null && styles.branchChipActive]}
                  onPress={() => setBranchId(null)}
                >
                  <Text style={[styles.branchChipText, branchId === null && styles.branchChipTextActive]}>
                    All Branches
                  </Text>
                </Pressable>
              )}
              {branches.map((b) => (
                <Pressable
                  key={b.id}
                  style={[styles.branchChip, branchId === b.id && styles.branchChipActive]}
                  onPress={() => setBranchId(b.id)}
                >
                  <Text style={[styles.branchChipText, branchId === b.id && styles.branchChipTextActive]}>
                    {b.branchName}
                  </Text>
                </Pressable>
              ))}
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={handleCreate} disabled={saving}>
              {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveButtonText}>Create Account</Text>}
            </Pressable>

            <Pressable style={styles.cancelButton} onPress={() => setCreating(false)}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
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
    userName: {
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
    addButton: {
      backgroundColor: colors.peachPrimary,
      borderRadius: radii.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.xs,
    },
    addButtonText: {
      color: colors.white,
      fontWeight: '700',
      fontSize: 11.5,
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
      marginBottom: spacing.md,
    },
    fieldLabel: {
      fontSize: 9.5,
      fontWeight: '700',
      color: colors.navyText,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    hintInline: {
      fontSize: 9,
      fontWeight: '400',
      color: colors.muted,
      textTransform: 'none',
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
    branchChipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    branchChip: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.sm,
      borderWidth: 1.5,
      borderColor: colors.navyDeep,
    },
    branchChipActive: {
      backgroundColor: colors.chrome,
      borderColor: colors.chrome,
    },
    branchChipText: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.navyDeep,
    },
    branchChipTextActive: {
      color: colors.cream,
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
