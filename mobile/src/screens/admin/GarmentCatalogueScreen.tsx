import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AppScreen } from '../../components/AppScreen';
import { NivenxaFooter } from '../../components/BrandComponents';
import { PriceChip } from '../../components/PriceChip';
import { Tag } from '../../components/Tag';
import { useTheme } from '../../context/ThemeContext';
import {
  fetchGarments,
  createGarment,
  updateGarment,
  deleteGarment,
  Garment,
  ServiceType,
  PricingUnit,
} from '../../api/garments';
import { getServiceTag, SPECIAL_CARE_TAG } from '../../theme/serviceTag';
import { ColorTokens, radii, spacing } from '../../theme/theme';

// specialty_care is not a valid serviceType (CLAUDE.md "requiresSpecialCare
// — RESOLVED") — special-care handling is the separate boolean toggle below.
const SERVICE_TYPES: ServiceType[] = ['wash_fold', 'ironing', 'dry_clean'];

export const GarmentCatalogueScreen: React.FC = () => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const serviceTag = useMemo(() => getServiceTag(colors), [colors]);

  const [garments, setGarments] = useState<Garment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Garment | 'new' | null>(null);
  const [itemName, setItemName] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [priceMaxInput, setPriceMaxInput] = useState('');
  const [pricingUnit, setPricingUnit] = useState<PricingUnit>('per_piece');
  const [serviceType, setServiceType] = useState<ServiceType>('wash_fold');
  const [isStartingPrice, setIsStartingPrice] = useState(false);
  const [requiresSpecialCare, setRequiresSpecialCare] = useState(false);
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
    setCategory('');
    setPrice('');
    setPriceMaxInput('');
    setPricingUnit('per_piece');
    setServiceType('wash_fold');
    setIsStartingPrice(false);
    setRequiresSpecialCare(false);
    setError(null);
  };

  const openEdit = (garment: Garment) => {
    setEditing(garment);
    setItemName(garment.itemName);
    setCategory(garment.category ?? '');
    setPrice(garment.price);
    setPriceMaxInput(garment.priceMax ?? '');
    setPricingUnit(garment.pricingUnit);
    setServiceType(garment.serviceType);
    setIsStartingPrice(garment.isStartingPrice);
    setRequiresSpecialCare(garment.requiresSpecialCare);
    setError(null);
  };

  const handleSave = async () => {
    if (!itemName || !price) {
      setError('Name and price are required.');
      return;
    }

    const priceMax = priceMaxInput ? Number(priceMaxInput) : null;
    if (priceMax !== null && priceMax < Number(price)) {
      setError('Price Max must be greater than or equal to Price.');
      return;
    }

    const payload = {
      itemName,
      price: Number(price),
      serviceType,
      category: category || undefined,
      pricingUnit,
      priceMax,
      isStartingPrice,
      requiresSpecialCare,
    };

    setSaving(true);
    setError(null);
    try {
      if (editing === 'new') {
        await createGarment(payload);
      } else if (editing) {
        await updateGarment(editing.id, payload);
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
                  {garment.requiresSpecialCare && <Tag {...SPECIAL_CARE_TAG} />}
                </View>
                <PriceChip amount={Number(garment.price)} variant="navy" />
              </View>
              {garment.category && <Text style={styles.categorySub}>{garment.category}</Text>}
              {garment.pricingUnit === 'per_kg' && <Text style={styles.categorySub}>Priced per kg</Text>}
              {garment.isStartingPrice && <Text style={styles.categorySub}>Starting price (onwards)</Text>}
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

            <Text style={styles.fieldLabel}>Category</Text>
            <TextInput
              style={styles.field}
              value={category}
              onChangeText={setCategory}
              placeholder="Men's Wear (Dry Cleaning)"
              placeholderTextColor={colors.muted}
            />

            <Text style={styles.fieldLabel}>Pricing Unit</Text>
            <View style={styles.serviceToggleRow}>
              {(['per_piece', 'per_kg'] as PricingUnit[]).map((unit) => (
                <Pressable
                  key={unit}
                  style={[styles.serviceToggle, pricingUnit === unit && styles.serviceToggleActive]}
                  onPress={() => setPricingUnit(unit)}
                >
                  <Text style={[styles.serviceToggleText, pricingUnit === unit && styles.serviceToggleTextActive]}>
                    {unit === 'per_piece' ? 'Per Piece' : 'Per KG'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Price {pricingUnit === 'per_kg' ? '(₹ per kg)' : '(₹ per piece)'}</Text>
            <TextInput
              style={styles.field}
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              placeholder="25"
              placeholderTextColor={colors.muted}
            />

            <Text style={styles.fieldLabel}>Price Max (optional — for range-priced items)</Text>
            <TextInput
              style={styles.field}
              value={priceMaxInput}
              onChangeText={setPriceMaxInput}
              keyboardType="decimal-pad"
              placeholder="e.g. 150"
              placeholderTextColor={colors.muted}
            />

            <Text style={styles.fieldLabel}>Starting Price ("onwards" — no upper bound)</Text>
            <View style={styles.serviceToggleRow}>
              {[
                { value: false, label: 'No' },
                { value: true, label: 'Yes' },
              ].map((opt) => (
                <Pressable
                  key={String(opt.value)}
                  style={[styles.serviceToggle, isStartingPrice === opt.value && styles.serviceToggleActive]}
                  onPress={() => setIsStartingPrice(opt.value)}
                >
                  <Text
                    style={[styles.serviceToggleText, isStartingPrice === opt.value && styles.serviceToggleTextActive]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>

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

            <Text style={styles.fieldLabel}>Requires Special Care</Text>
            <View style={styles.serviceToggleRow}>
              {[
                { value: false, label: 'No' },
                { value: true, label: 'Yes' },
              ].map((opt) => (
                <Pressable
                  key={String(opt.value)}
                  style={[styles.serviceToggle, requiresSpecialCare === opt.value && styles.serviceToggleActive]}
                  onPress={() => setRequiresSpecialCare(opt.value)}
                >
                  <Text
                    style={[
                      styles.serviceToggleText,
                      requiresSpecialCare === opt.value && styles.serviceToggleTextActive,
                    ]}
                  >
                    {opt.label}
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
    categorySub: {
      fontSize: 9.5,
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
