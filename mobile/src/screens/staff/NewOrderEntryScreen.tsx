import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppScreen } from '../../components/AppScreen';
import { PriceChip } from '../../components/PriceChip';
import { Tag } from '../../components/Tag';
import { useAuth } from '../../context/AuthContext';
import { fetchGarments, Garment } from '../../api/garments';
import { createOrder } from '../../api/orders';
import { ApiError } from '../../api/client';
import { colors, radii, spacing } from '../../theme/theme';
import { SERVICE_TAG } from '../../theme/serviceTag';
import type { StaffStackParamList } from '../../navigation/StaffStack';

type Nav = NativeStackNavigationProp<StaffStackParamList, 'NewOrderEntry'>;

export const NewOrderEntryScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { state } = useAuth();
  const user = state.status === 'signedIn' ? state.user : null;

  const [garments, setGarments] = useState<Garment[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [chosenPrices, setChosenPrices] = useState<Record<string, number>>({});
  const [customerName, setCustomerName] = useState('');
  const [customerPhoneNumber, setCustomerPhoneNumber] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGarments()
      .then((fetched) => {
        setGarments(fetched);
        // Range-priced items (e.g. Designer Dress) default to the low end of
        // the range; staff adjust from there.
        setChosenPrices(
          Object.fromEntries(
            fetched.filter((g) => g.priceMax !== null).map((g) => [g.id, Number(g.price)])
          )
        );
      })
      .catch(() => setError('Could not load the garment catalogue.'))
      .finally(() => setLoading(false));
  }, []);

  const adjustQuantity = (garmentId: string, delta: number) => {
    setQuantities((prev) => {
      const next = Math.max(0, (prev[garmentId] ?? 0) + delta);
      return { ...prev, [garmentId]: next };
    });
  };

  const adjustChosenPrice = (garment: Garment, delta: number) => {
    const min = Number(garment.price);
    const max = Number(garment.priceMax);
    setChosenPrices((prev) => {
      const current = prev[garment.id] ?? min;
      const next = Math.min(max, Math.max(min, current + delta));
      return { ...prev, [garment.id]: next };
    });
  };

  const unitPriceFor = (garment: Garment) =>
    garment.priceMax !== null ? chosenPrices[garment.id] ?? Number(garment.price) : Number(garment.price);

  const estimatedTotal = useMemo(
    () =>
      garments.reduce((sum, garment) => {
        const qty = quantities[garment.id] ?? 0;
        return sum + qty * unitPriceFor(garment);
      }, 0),
    [garments, quantities, chosenPrices]
  );

  const handleConfirm = async () => {
    if (!user?.branchId) {
      setError('Your account is not assigned to a branch.');
      return;
    }

    const items = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([garmentId, quantity]) => {
        const garment = garments.find((g) => g.id === garmentId);
        const chosenPrice = garment && garment.priceMax !== null ? chosenPrices[garmentId] : undefined;
        return { garmentId, quantity, ...(chosenPrice !== undefined ? { chosenPrice } : {}) };
      });

    if (items.length === 0) {
      setError('Add at least one garment.');
      return;
    }

    if (!customerName || !customerPhoneNumber || !locationLabel) {
      setError('Customer name, phone number, and location are required.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await createOrder({
        customerName,
        customerPhoneNumber,
        locationLabel,
        branchId: user.branchId,
        pickupDate: new Date().toISOString(),
        items,
      });
      navigation.goBack();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the order.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppScreen scroll={false}>
      <View style={styles.appbar}>
        <Text style={styles.title}>New Order</Text>
        <Text style={styles.subtitle}>Enter customer and garment details</Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.fieldLabel}>Customer Name</Text>
        <TextInput style={styles.field} value={customerName} onChangeText={setCustomerName} placeholder="Priya Menon" />
        <Text style={styles.fieldLabel}>Phone Number</Text>
        <TextInput
          style={styles.field}
          value={customerPhoneNumber}
          onChangeText={setCustomerPhoneNumber}
          placeholder="+91 98xxxxxx45"
          keyboardType="phone-pad"
        />
        <Text style={styles.fieldLabel}>Location (flat / house / shop no.)</Text>
        <TextInput style={styles.field} value={locationLabel} onChangeText={setLocationLabel} placeholder="A-304" />

        <Text style={styles.sectionTitle}>Garments Collected</Text>

        {loading ? (
          <ActivityIndicator color={colors.peachPrimary} style={{ marginTop: spacing.lg }} />
        ) : (
          <View style={styles.garmentCard}>
            {garments.map((garment, index) => (
              <View
                key={garment.id}
                style={[styles.garmentRow, index === garments.length - 1 && styles.garmentRowLast]}
              >
                <View>
                  <View style={styles.garmentNameRow}>
                    <Text style={styles.garmentName}>{garment.itemName}</Text>
                    <Tag {...SERVICE_TAG[garment.serviceType]} />
                  </View>
                  {garment.priceMax !== null ? (
                    <View style={styles.priceRangeRow}>
                      <Pressable style={styles.priceStepperBtn} onPress={() => adjustChosenPrice(garment, -5)}>
                        <Text style={styles.stepperBtnText}>–</Text>
                      </Pressable>
                      <Text style={styles.garmentPrice}>
                        ₹{unitPriceFor(garment)} / piece (₹{garment.price}–₹{garment.priceMax})
                      </Text>
                      <Pressable style={styles.priceStepperBtn} onPress={() => adjustChosenPrice(garment, 5)}>
                        <Text style={styles.stepperBtnText}>+</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Text style={styles.garmentPrice}>₹{garment.price} / piece</Text>
                  )}
                </View>
                <View style={styles.stepper}>
                  <Pressable style={styles.stepperBtn} onPress={() => adjustQuantity(garment.id, -1)}>
                    <Text style={styles.stepperBtnText}>–</Text>
                  </Pressable>
                  <Text style={styles.stepperNum}>{quantities[garment.id] ?? 0}</Text>
                  <Pressable style={styles.stepperBtn} onPress={() => adjustQuantity(garment.id, 1)}>
                    <Text style={styles.stepperBtnText}>+</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.totalBar}>
          <Text style={styles.totalLabel}>ESTIMATED TOTAL</Text>
          <PriceChip amount={estimatedTotal} />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={[styles.confirmButton, submitting && styles.confirmButtonDisabled]} onPress={handleConfirm} disabled={submitting}>
          {submitting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.confirmButtonText}>Confirm Pickup</Text>}
        </Pressable>
      </View>
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
  sectionTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.navyText,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  garmentCard: {
    backgroundColor: colors.peachCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: 13,
  },
  garmentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderStyle: 'dashed',
  },
  garmentRowLast: {
    borderBottomWidth: 0,
  },
  garmentNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  garmentName: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.navyText,
  },
  garmentPrice: {
    fontSize: 10.5,
    color: colors.muted,
    marginTop: 2,
  },
  priceRangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  priceStepperBtn: {
    width: 18,
    height: 18,
    borderRadius: 5,
    backgroundColor: colors.peachBg,
    borderWidth: 1,
    borderColor: colors.peachPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepperBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: colors.peachBg,
    borderWidth: 1,
    borderColor: colors.peachPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: {
    color: colors.navyDeep,
    fontWeight: '800',
    fontSize: 14,
  },
  stepperNum: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.navyText,
    minWidth: 16,
    textAlign: 'center',
  },
  totalBar: {
    backgroundColor: colors.navyDeep,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  totalLabel: {
    fontSize: 10,
    color: '#C8A67B',
    fontWeight: '600',
  },
  error: {
    color: colors.danger,
    fontSize: 11,
    marginTop: spacing.sm,
  },
  confirmButton: {
    backgroundColor: colors.peachPrimary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  confirmButtonDisabled: {
    opacity: 0.7,
  },
  confirmButtonText: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 11.5,
  },
});
