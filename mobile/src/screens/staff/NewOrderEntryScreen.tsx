 import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppScreen } from '../../components/AppScreen';
import { PriceChip } from '../../components/PriceChip';
import { Tag } from '../../components/Tag';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fetchGarments, Garment } from '../../api/garments';
import { createOrder } from '../../api/orders';
import { searchCustomers, createCustomer, markBagIssued, CustomerLookup } from '../../api/customers';
import { ApiError } from '../../api/client';
import { ColorTokens, radii, spacing } from '../../theme/theme';
import { getServiceTag, SPECIAL_CARE_TAG } from '../../theme/serviceTag';
import type { StaffStackParamList } from '../../navigation/StaffStack';

type Nav = NativeStackNavigationProp<StaffStackParamList, 'NewOrderEntry'>;

// Sourced from garments-seed-data-v2.json businessInfo.laundryMinimumKg —
// mirrors the backend's order-level 5kg minimum (src/services/orderService.ts)
// so the estimate shown here matches what the server will actually charge.
const LAUNDRY_MINIMUM_KG = 5;

export const NewOrderEntryScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { state } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const serviceTag = useMemo(() => getServiceTag(colors), [colors]);
  const user = state.status === 'signedIn' ? state.user : null;

  const [garments, setGarments] = useState<Garment[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  // Range-priced items (priceMax, e.g. Designer Dress) — stepper-driven.
  const [chosenPrices, setChosenPrices] = useState<Record<string, number>>({});
  // Starting-price ("onwards") items — free-text entry, staff types the
  // actual price at pickup. Kept as text (not number) to allow normal
  // in-progress typing states.
  const [enteredPrices, setEnteredPrices] = useState<Record<string, string>>({});
  // Per-KG items — free-text weight entry.
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [customerName, setCustomerName] = useState('');
  const [customerPhoneNumber, setCustomerPhoneNumber] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // CLAUDE.md "Customer creation — real gap": staff search by phone first,
  // then either pick an existing customer/location or add a new one, before
  // the garment picker unlocks — one continuous flow, not a separate screen.
  const [customerConfirmed, setCustomerConfirmed] = useState(false);
  const [phoneQuery, setPhoneQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // null = haven't searched yet; [] = searched, no matches (show new-customer form).
  const [searchResults, setSearchResults] = useState<CustomerLookup[] | null>(null);
  const [confirmingNewCustomer, setConfirmingNewCustomer] = useState(false);

  // CLAUDE.md "Laundry bag tracking" — free bag, issued once per customer;
  // surfaced here since staff is physically at the pickup handing it over.
  const [confirmedCustomerId, setConfirmedCustomerId] = useState<string | null>(null);
  const [bagIssued, setBagIssued] = useState(false);
  const [issuingBag, setIssuingBag] = useState(false);

  useEffect(() => {
    fetchGarments()
      .then((fetched) => {
        setGarments(fetched);
        // Range-priced items default to the low end of the range; staff
        // adjust from there.
        setChosenPrices(
          Object.fromEntries(fetched.filter((g) => g.priceMax !== null).map((g) => [g.id, Number(g.price)]))
        );
        // Starting-price items default their text entry to the floor.
        setEnteredPrices(
          Object.fromEntries(fetched.filter((g) => g.isStartingPrice).map((g) => [g.id, String(g.price)]))
        );
      })
      .catch(() => setError('Could not load the garment catalogue.'))
      .finally(() => setLoading(false));
  }, []);

  const groupedGarments = useMemo(() => {
    const groups = new Map<string, Garment[]>();
    for (const garment of garments) {
      const key = garment.category ?? 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(garment);
    }
    return Array.from(groups.entries());
  }, [garments]);

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

  const unitPriceFor = (garment: Garment) => {
    if (garment.priceMax !== null || garment.isStartingPrice) {
      return chosenPrices[garment.id] ?? Number(garment.price);
    }
    return Number(garment.price);
  };

  const enteredPriceBelowFloor = (garment: Garment) => {
    const entered = parseFloat(enteredPrices[garment.id] ?? '');
    return Number.isFinite(entered) && entered < Number(garment.price);
  };

  const totalPerKgWeight = useMemo(
    () =>
      garments
        .filter((g) => g.pricingUnit === 'per_kg')
        .reduce((sum, g) => sum + (parseFloat(weights[g.id] ?? '') || 0), 0),
    [garments, weights]
  );

  const estimatedTotal = useMemo(() => {
    let pieceTotal = 0;
    let perKgRawTotal = 0;

    for (const garment of garments) {
      if (garment.pricingUnit === 'per_kg') {
        const weight = parseFloat(weights[garment.id] ?? '') || 0;
        if (weight > 0) perKgRawTotal += weight * Number(garment.price);
        continue;
      }

      const qty = quantities[garment.id] ?? 0;
      if (qty > 0) {
        const price = garment.isStartingPrice
          ? parseFloat(enteredPrices[garment.id] ?? '') || Number(garment.price)
          : unitPriceFor(garment);
        pieceTotal += qty * price;
      }
    }

    // Mirror the backend's order-level 5kg minimum so this estimate matches
    // what will actually be charged.
    const perKgFinal =
      totalPerKgWeight > 0 && totalPerKgWeight < LAUNDRY_MINIMUM_KG
        ? perKgRawTotal * (LAUNDRY_MINIMUM_KG / totalPerKgWeight)
        : perKgRawTotal;

    return pieceTotal + perKgFinal;
  }, [garments, quantities, chosenPrices, enteredPrices, weights, totalPerKgWeight]);

  const handleConfirm = async () => {
    if (!user?.branchId) {
      setError('Your account is not assigned to a branch.');
      return;
    }

    const items: { garmentId: string; quantity?: number; weightKg?: number; chosenPrice?: number }[] = [];
    let validationError: string | null = null;

    for (const garment of garments) {
      if (garment.pricingUnit === 'per_kg') {
        const weight = parseFloat(weights[garment.id] ?? '') || 0;
        if (weight > 0) items.push({ garmentId: garment.id, weightKg: weight });
        continue;
      }

      const qty = quantities[garment.id] ?? 0;
      if (qty <= 0) continue;

      if (garment.priceMax !== null) {
        items.push({ garmentId: garment.id, quantity: qty, chosenPrice: chosenPrices[garment.id] ?? Number(garment.price) });
      } else if (garment.isStartingPrice) {
        const entered = parseFloat(enteredPrices[garment.id] ?? '');
        const floor = Number(garment.price);
        if (!Number.isFinite(entered) || entered < floor) {
          validationError = `${garment.itemName} price must be at least ₹${garment.price}.`;
          break;
        }
        items.push({ garmentId: garment.id, quantity: qty, chosenPrice: entered });
      } else {
        items.push({ garmentId: garment.id, quantity: qty });
      }
    }

    if (validationError) {
      setError(validationError);
      return;
    }

    if (items.length === 0) {
      setError('Add at least one garment.');
      return;
    }

    if (!customerConfirmed || !customerName || !customerPhoneNumber || !locationLabel) {
      setError('Find or add a customer before confirming the pickup.');
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

  const handleSearchCustomer = async () => {
    if (!phoneQuery) return;
    setSearching(true);
    setSearchError(null);
    try {
      const results = await searchCustomers(phoneQuery);
      setSearchResults(results);
      if (results.length === 0) {
        // No match — prefill the new-customer form with the number already typed.
        setCustomerPhoneNumber(phoneQuery);
        setCustomerName('');
        setLocationLabel('');
      }
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.message : 'Could not search for this customer.');
    } finally {
      setSearching(false);
    }
  };

  const selectExistingCustomer = (customer: CustomerLookup) => {
    setCustomerName(customer.fullName);
    setCustomerPhoneNumber(customer.phoneNumber);
    setLocationLabel(customer.locationLabel);
    setConfirmedCustomerId(customer.id);
    setBagIssued(customer.bagIssued);
    setCustomerConfirmed(true);
  };

  const startNewCustomerAtThisNumber = () => {
    setCustomerPhoneNumber(phoneQuery);
    setCustomerName('');
    setLocationLabel('');
    setSearchResults([]);
  };

  const handleConfirmNewCustomer = async () => {
    if (!customerName || !locationLabel) {
      setError('Customer name and location are required.');
      return;
    }

    setError(null);
    setConfirmingNewCustomer(true);
    try {
      const customer = await createCustomer({ fullName: customerName, phoneNumber: customerPhoneNumber, locationLabel });
      setConfirmedCustomerId(customer.id);
      setBagIssued(customer.bagIssued);
      setCustomerConfirmed(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this customer.');
    } finally {
      setConfirmingNewCustomer(false);
    }
  };

  const handleIssueBag = async () => {
    if (!confirmedCustomerId) return;
    setIssuingBag(true);
    try {
      await markBagIssued(confirmedCustomerId);
      setBagIssued(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark the bag as issued.');
    } finally {
      setIssuingBag(false);
    }
  };

  const resetCustomer = () => {
    setCustomerConfirmed(false);
    setSearchResults(null);
    setSearchError(null);
    setPhoneQuery('');
    setCustomerName('');
    setCustomerPhoneNumber('');
    setLocationLabel('');
    setConfirmedCustomerId(null);
    setBagIssued(false);
  };

  const renderGarmentRow = (garment: Garment, isLast: boolean) => {
    if (garment.pricingUnit === 'per_kg') {
      const weightText = weights[garment.id] ?? '';

      return (
        <View key={garment.id} style={[styles.garmentRow, isLast && styles.garmentRowLast]}>
          <View style={styles.garmentInfo}>
            <View style={styles.garmentNameRow}>
              <Text style={styles.garmentName}>{garment.itemName}</Text>
              <Tag {...serviceTag[garment.serviceType]} />
              {garment.requiresSpecialCare && <Tag {...SPECIAL_CARE_TAG} />}
            </View>
            <Text style={styles.garmentPrice}>₹{garment.price} / kg</Text>
          </View>
          <View style={styles.weightInputWrap}>
            <TextInput
              style={styles.weightInput}
              value={weightText}
              onChangeText={(text) => setWeights((prev) => ({ ...prev, [garment.id]: text }))}
              placeholder="0.0"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
            />
            <Text style={styles.weightUnit}>kg</Text>
          </View>
        </View>
      );
    }

    return (
      <View key={garment.id} style={[styles.garmentRow, isLast && styles.garmentRowLast]}>
        <View style={styles.garmentInfo}>
          <View style={styles.garmentNameRow}>
            <Text style={styles.garmentName}>{garment.itemName}</Text>
            <Tag {...serviceTag[garment.serviceType]} />
            {garment.requiresSpecialCare && <Tag {...SPECIAL_CARE_TAG} />}
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
          ) : garment.isStartingPrice ? (
            <View style={styles.startingPriceRow}>
              <Text style={styles.garmentPrice}>₹{garment.price} onwards</Text>
              <TextInput
                style={styles.startingPriceInput}
                value={enteredPrices[garment.id] ?? ''}
                onChangeText={(text) => setEnteredPrices((prev) => ({ ...prev, [garment.id]: text }))}
                placeholder={`${garment.price}`}
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
              />
            </View>
          ) : (
            <Text style={styles.garmentPrice}>₹{garment.price} / piece</Text>
          )}
          {garment.isStartingPrice && enteredPriceBelowFloor(garment) && (
            <Text style={styles.minimumNote}>Must be at least ₹{garment.price}</Text>
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
    );
  };

  return (
    <AppScreen scroll={false}>
      <View style={styles.appbar}>
        <Text style={styles.title}>New Order</Text>
        <Text style={styles.subtitle}>Enter customer and garment details</Text>
      </View>

      <View style={styles.body}>
        {!customerConfirmed ? (
          <>
            <Text style={styles.fieldLabel}>Customer Phone Number</Text>
            <View style={styles.phoneSearchRow}>
              <TextInput
                style={[styles.field, styles.phoneSearchInput]}
                value={phoneQuery}
                onChangeText={setPhoneQuery}
                placeholder="+91 98xxxxxx45"
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
              />
              <Pressable
                style={[styles.searchButton, (searching || !phoneQuery) && styles.confirmButtonDisabled]}
                onPress={handleSearchCustomer}
                disabled={searching || !phoneQuery}
              >
                {searching ? <ActivityIndicator color={colors.white} /> : <Text style={styles.searchButtonText}>Find</Text>}
              </Pressable>
            </View>
            {searchError && <Text style={styles.error}>{searchError}</Text>}

            {searchResults !== null && searchResults.length > 0 && (
              <View style={styles.resultsBlock}>
                <Text style={styles.resultsLabel}>Existing customers at this number</Text>
                {searchResults.map((c) => (
                  <Pressable key={c.id} style={styles.resultCard} onPress={() => selectExistingCustomer(c)}>
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultName}>{c.fullName}</Text>
                      <Text style={styles.resultLocation}>{c.locationLabel}</Text>
                    </View>
                    {c.billingMode === 'monthly_billing' && (
                      <Tag label="Monthly" bg={colors.warningBg} color={colors.warning} />
                    )}
                  </Pressable>
                ))}
                <Pressable style={styles.newLocationLink} onPress={startNewCustomerAtThisNumber}>
                  <Text style={styles.newLocationLinkText}>+ New customer / location for this number</Text>
                </Pressable>
              </View>
            )}

            {searchResults !== null && searchResults.length === 0 && (
              <View style={styles.newCustomerBlock}>
                <Text style={styles.fieldLabel}>Customer Name</Text>
                <TextInput
                  style={styles.field}
                  value={customerName}
                  onChangeText={setCustomerName}
                  placeholder="Priya Menon"
                  placeholderTextColor={colors.muted}
                />
                <Text style={styles.fieldLabel}>Location (flat / house / shop no.)</Text>
                <TextInput
                  style={styles.field}
                  value={locationLabel}
                  onChangeText={setLocationLabel}
                  placeholder="A-304"
                  placeholderTextColor={colors.muted}
                />
                <Pressable
                  style={[styles.addButton, confirmingNewCustomer && styles.confirmButtonDisabled]}
                  onPress={handleConfirmNewCustomer}
                  disabled={confirmingNewCustomer}
                >
                  {confirmingNewCustomer ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <Text style={styles.addButtonText}>Confirm Customer</Text>
                  )}
                </Pressable>
              </View>
            )}

            {error && <Text style={styles.error}>{error}</Text>}
          </>
        ) : (
          <>
            <View style={styles.confirmedCustomerCard}>
              <View style={styles.resultInfo}>
                <Text style={styles.resultName}>{customerName}</Text>
                <Text style={styles.resultLocation}>
                  {customerPhoneNumber} · {locationLabel}
                </Text>
              </View>
              <Pressable onPress={resetCustomer}>
                <Text style={styles.changeCustomerLink}>Change</Text>
              </Pressable>
            </View>

            {/* CLAUDE.md "Laundry bag tracking" — free, issued once per
                customer; staff is physically at the pickup, so this is the
                natural moment to hand it over and record it. */}
            <View style={styles.bagRow}>
              {bagIssued ? (
                <Tag label="Bag Issued" bg={colors.successBg} color={colors.success} />
              ) : (
                <Pressable style={styles.issueBagButton} onPress={handleIssueBag} disabled={issuingBag}>
                  {issuingBag ? (
                    <ActivityIndicator color={colors.peachPrimary} />
                  ) : (
                    <Text style={styles.issueBagButtonText}>Issue Laundry Bag (Free)</Text>
                  )}
                </Pressable>
              )}
            </View>

            <Text style={styles.sectionTitle}>Garments Collected</Text>

            {loading ? (
              <ActivityIndicator color={colors.peachPrimary} style={{ marginTop: spacing.lg }} />
            ) : (
              <ScrollView style={styles.garmentScroll} showsVerticalScrollIndicator={false}>
                {groupedGarments.map(([category, items]) => (
                  <View key={category} style={styles.categoryBlock}>
                    <Text style={styles.categoryHeader}>{category}</Text>
                    <View style={styles.garmentCard}>
                      {items.map((garment, index) => renderGarmentRow(garment, index === items.length - 1))}
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}

            {totalPerKgWeight > 0 && totalPerKgWeight < LAUNDRY_MINIMUM_KG && (
              <Text style={styles.minimumBanner}>
                Per-KG minimum is {LAUNDRY_MINIMUM_KG}kg per order — {totalPerKgWeight.toFixed(1)}kg entered, minimum
                charge will apply.
              </Text>
            )}

            <View style={styles.totalBar}>
              <Text style={styles.totalLabel}>ESTIMATED TOTAL</Text>
              <PriceChip amount={Math.round(estimatedTotal * 100) / 100} />
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable
              style={[styles.confirmButton, submitting && styles.confirmButtonDisabled]}
              onPress={handleConfirm}
              disabled={submitting}
            >
              {submitting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.confirmButtonText}>Confirm Pickup</Text>}
            </Pressable>
          </>
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
    phoneSearchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    phoneSearchInput: {
      flex: 1,
    },
    searchButton: {
      backgroundColor: colors.peachPrimary,
      borderRadius: radii.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
    },
    searchButtonText: {
      color: colors.white,
      fontWeight: '700',
      fontSize: 11.5,
    },
    resultsBlock: {
      marginBottom: spacing.sm,
    },
    resultsLabel: {
      fontSize: 9.5,
      fontWeight: '700',
      color: colors.muted,
      textTransform: 'uppercase',
      marginBottom: spacing.xs,
    },
    resultCard: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: colors.peachCard,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.md,
      padding: spacing.sm,
      marginBottom: spacing.xs,
    },
    resultInfo: {
      flexShrink: 1,
    },
    resultName: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.navyText,
    },
    resultLocation: {
      fontSize: 10.5,
      color: colors.muted,
      marginTop: 1,
    },
    newLocationLink: {
      paddingVertical: spacing.sm,
      alignItems: 'center',
    },
    newLocationLinkText: {
      color: colors.peachPrimary,
      fontWeight: '700',
      fontSize: 11,
    },
    newCustomerBlock: {
      marginBottom: spacing.sm,
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
    confirmedCustomerCard: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: colors.peachCard,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    changeCustomerLink: {
      color: colors.peachPrimary,
      fontWeight: '700',
      fontSize: 11,
    },
    bagRow: {
      marginBottom: spacing.sm,
    },
    issueBagButton: {
      alignSelf: 'flex-start',
      borderWidth: 1.5,
      borderColor: colors.peachPrimary,
      borderRadius: radii.sm,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
    },
    issueBagButtonText: {
      color: colors.peachPrimary,
      fontWeight: '700',
      fontSize: 10.5,
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
    sectionTitle: {
      fontSize: 12.5,
      fontWeight: '700',
      color: colors.navyText,
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
    },
    garmentScroll: {
      flex: 1,
    },
    categoryBlock: {
      marginBottom: spacing.md,
    },
    categoryHeader: {
      fontSize: 10.5,
      fontWeight: '800',
      color: colors.muted,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: spacing.xs,
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
    garmentInfo: {
      flexShrink: 1,
      paddingRight: spacing.sm,
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
    startingPriceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginTop: 2,
    },
    startingPriceInput: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.peachPrimary,
      borderRadius: 6,
      paddingVertical: 2,
      paddingHorizontal: spacing.xs,
      fontSize: 10.5,
      color: colors.navyText,
      minWidth: 54,
    },
    weightInputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    weightInput: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.peachPrimary,
      borderRadius: 6,
      paddingVertical: 4,
      paddingHorizontal: spacing.sm,
      fontSize: 12,
      color: colors.navyText,
      minWidth: 56,
      textAlign: 'right',
    },
    weightUnit: {
      fontSize: 10.5,
      color: colors.muted,
      fontWeight: '600',
    },
    minimumNote: {
      fontSize: 9.5,
      color: colors.danger,
      marginTop: 2,
    },
    minimumBanner: {
      fontSize: 10,
      color: colors.warning,
      backgroundColor: colors.warningBg,
      borderRadius: radii.sm,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      marginTop: spacing.sm,
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
      backgroundColor: colors.chrome,
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
