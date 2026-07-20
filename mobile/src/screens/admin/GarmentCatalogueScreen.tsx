import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AppScreen } from '../../components/AppScreen';
import { NivenxaFooter } from '../../components/BrandComponents';
import { PriceChip } from '../../components/PriceChip';
import { Tag } from '../../components/Tag';
import { useTheme } from '../../context/ThemeContext';
import { fetchGarments, createGarment, updateGarment, deleteGarment, Garment, ServiceType } from '../../api/garments';
import { getServiceTag } from '../../theme/serviceTag';
import { ColorTokens, radii, spacing } from '../../theme/theme';

const SERVICE_TYPES: ServiceType[] = ['wash_fold', 'ironing', 'dry_clean', 'specialty_care'];

export const GarmentCatalogueScreen: React.FC = () => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const serviceTag = useMemo(() => getServiceTag(colors), [colors]);

  const [garments, setGarments] = useState<Garment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Garment | 'new' | null>(null);
  const [itemName, setItemName] = useState('');
  const [price, setPrice] = useState('');
  const [serviceType, setServiceType] = useState<ServiceType>('laundry');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setGarments(await fetchGarments());
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
    setItemName('');
    setPrice('');
    setServiceType('laundry');
    setError(null);
  };

  const openEdit = (garment: Garment) => {
    setEditing(garment);
    setItemName(garment.itemName);
    setPrice(garment.price);
    setServiceType(garment.serviceType);
    setError(null);
  };

  const handleSave = async () => {
    if (!itemName || !price) {
      setError('Name and price are required.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editing === 'new') {
        await createGarment({ itemName, price: Number(price), serviceType });
      } else if (editing) {
        await updateGarment(editing.id, { itemName, price: Number(price), serviceType });
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError('Could not save this garment.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (editing === 'new' || !editing) return;
    setSaving(true);
    try {
      await deleteGarment(editing.id);
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppScreen scroll={false}>
      <View style={styles.appbar}>
        <Text style={styles.title}>Garment Catalogue</Text>
        <Text style={styles.subtitle}>{garments.length} items · Editable by Admin only</Text>
      </View>

      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator color={colors.peachPrimary} style={{ marginTop: spacing.xl }} />
        ) : (
          garments.map((garment) => (
            <Pressable key={garment.id} style={styles.card} onPress={() => openEdit(garment)}>
              <View style={styles.cardRow}>
                <View style={styles.nameRow}>
                  <Text style={styles.garmentName}>{garment.itemName}</Text>
                  <Tag {...serviceTag[garment.serviceType]} />
                </View>
                <PriceChip amount={Number(garment.price)} variant="navy" />
              </View>
            </Pressable>
          ))
        )}

        <Pressable style={styles.addButton} onPress={openNew}>
          <Text style={styles.addButtonText}>+ Add Garment</Text>
        </Pressable>
      </View>

      <Modal visible={editing !== null} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editing === 'new' ? 'Add Garment' : 'Edit Garment'}</Text>

            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.field}
              value={itemName}
              onChangeText={setItemName}
              placeholder="Shirt"
              placeholderTextColor={colors.muted}
            />

            <Text style={styles.fieldLabel}>Price (₹ per piece)</Text>
            <TextInput
              style={styles.field}
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              placeholder="25"
              placeholderTextColor={colors.muted}
            />

            <Text style={styles.fieldLabel}>Service Type</Text>
            <View style={styles.serviceToggleRow}>
              {SERVICE_TYPES.map((type) => (
                <Pressable
                  key={type}
                  style={[styles.serviceToggle, serviceType === type && styles.serviceToggleActive]}
                  onPress={() => setServiceType(type)}
                >
                  <Text style={[styles.serviceToggleText, serviceType === type && styles.serviceToggleTextActive]}>
                    {serviceTag[type].label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveButtonText}>Save</Text>}
            </Pressable>

            {editing !== 'new' && (
              <Pressable style={styles.deleteButton} onPress={handleDelete} disabled={saving}>
                <Text style={styles.deleteButtonText}>Remove from Catalogue</Text>
              </Pressable>
            )}

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
    },
    garmentName: {
      fontSize: 11.5,
      fontWeight: '600',
      color: colors.navyText,
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
    serviceToggleRow: {
      flexDirection: 'row',
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    serviceToggle: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderRadius: radii.sm,
      borderWidth: 1.5,
      borderColor: colors.navyDeep,
    },
    serviceToggleActive: {
      backgroundColor: colors.chrome,
      borderColor: colors.chrome,
    },
    serviceToggleText: {
      fontSize: 9,
      fontWeight: '700',
      color: colors.navyDeep,
    },
    serviceToggleTextActive: {
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
    deleteButton: {
      alignItems: 'center',
      paddingVertical: spacing.md,
    },
    deleteButtonText: {
      color: colors.danger,
      fontWeight: '700',
      fontSize: 11,
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
