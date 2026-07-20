import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AppScreen } from '../../components/AppScreen';
import { NivenxaFooter } from '../../components/BrandComponents';
import { Tag } from '../../components/Tag';
import { fetchBranches, createBranch, updateBranch, Branch, BranchType } from '../../api/branches';
import { colors, radii, spacing } from '../../theme/theme';

const BRANCH_TAG: Record<BranchType, { label: string; bg: string; color: string }> = {
  apartment: { label: 'Apartment', bg: colors.peachBg, color: colors.peachPrimaryDark },
  area: { label: 'Area', bg: colors.successBg, color: colors.success },
};

const ADDRESS_PLACEHOLDER: Record<BranchType, string> = {
  apartment: 'Apartment complex name, street',
  area: 'Locality / area name, nearby landmark',
};

interface FormState {
  branchName: string;
  branchType: BranchType;
  phoneNumber: string;
  whatsappNumber: string;
  address: string;
  city: string;
}

const emptyForm: FormState = {
  branchName: '',
  branchType: 'apartment',
  phoneNumber: '',
  whatsappNumber: '',
  address: '',
  city: '',
};

export const BranchesScreen: React.FC = () => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBranches(await fetchBranches());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openNew = () => {
    setEditing('new');
    setForm(emptyForm);
    setError(null);
  };

  const openEdit = (branch: Branch) => {
    setEditing(branch);
    setForm({
      branchName: branch.branchName,
      branchType: branch.branchType,
      phoneNumber: branch.phoneNumber,
      whatsappNumber: branch.whatsappNumber ?? '',
      address: branch.address,
      city: branch.city,
    });
    setError(null);
  };

  const handleSave = async () => {
    if (!form.branchName || !form.phoneNumber || !form.address || !form.city) {
      setError('Name, phone number, address, and city are required.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editing === 'new') {
        await createBranch(form);
      } else if (editing) {
        await updateBranch(editing.id, form);
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError('Could not save this branch.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppScreen scroll={false}>
      <View style={styles.appbar}>
        <Text style={styles.title}>Branches</Text>
        <Text style={styles.subtitle}>{branches.length} active · Apartment or Area</Text>
      </View>

      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator color={colors.peachPrimary} style={{ marginTop: spacing.xl }} />
        ) : (
          branches.map((branch) => (
            <Pressable key={branch.id} style={styles.card} onPress={() => openEdit(branch)}>
              <View style={styles.nameRow}>
                <Text style={styles.cardTitle}>{branch.branchName}</Text>
                <Tag {...BRANCH_TAG[branch.branchType]} />
              </View>
              <Text style={styles.cardSub}>{branch.phoneNumber}</Text>
            </Pressable>
          ))
        )}

        <Pressable style={styles.addButton} onPress={openNew}>
          <Text style={styles.addButtonText}>+ Add Branch</Text>
        </Pressable>
      </View>

      <Modal visible={editing !== null} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editing === 'new' ? 'Add Branch' : 'Edit Branch'}</Text>

            <Text style={styles.fieldLabel}>Branch Name</Text>
            <TextInput
              style={styles.field}
              value={form.branchName}
              onChangeText={(v) => setForm({ ...form, branchName: v })}
              placeholder="Green Valley Apartments"
            />

            <Text style={styles.fieldLabel}>Type</Text>
            <View style={styles.typeToggleRow}>
              {(['apartment', 'area'] as BranchType[]).map((type) => (
                <Pressable
                  key={type}
                  style={[styles.typeToggle, form.branchType === type && styles.typeToggleActive]}
                  onPress={() => setForm({ ...form, branchType: type })}
                >
                  <Text style={[styles.typeToggleText, form.branchType === type && styles.typeToggleTextActive]}>
                    {BRANCH_TAG[type].label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Phone Number</Text>
            <TextInput
              style={styles.field}
              value={form.phoneNumber}
              onChangeText={(v) => setForm({ ...form, phoneNumber: v })}
              placeholder="+91 93981 25151"
              keyboardType="phone-pad"
            />

            <Text style={styles.fieldLabel}>WhatsApp Number (if different)</Text>
            <TextInput
              style={styles.field}
              value={form.whatsappNumber}
              onChangeText={(v) => setForm({ ...form, whatsappNumber: v })}
              placeholder="Same as phone number"
              keyboardType="phone-pad"
            />

            <Text style={styles.fieldLabel}>Address</Text>
            <TextInput
              style={styles.field}
              value={form.address}
              onChangeText={(v) => setForm({ ...form, address: v })}
              placeholder={ADDRESS_PLACEHOLDER[form.branchType]}
              placeholderTextColor={colors.muted}
            />

            <Text style={styles.fieldLabel}>City</Text>
            <TextInput style={styles.field} value={form.city} onChangeText={(v) => setForm({ ...form, city: v })} />

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

const styles = StyleSheet.create({
  appbar: {
    backgroundColor: colors.navyDeep,
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
  nameRow: {
    flexDirection: 'row',
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
    backgroundColor: colors.cream,
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
  typeToggleRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  typeToggle: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: colors.navyDeep,
  },
  typeToggleActive: {
    backgroundColor: colors.navyDeep,
  },
  typeToggleText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.navyDeep,
  },
  typeToggleTextActive: {
    color: colors.peachBg,
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
