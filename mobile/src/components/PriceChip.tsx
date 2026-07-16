import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors, radii } from '../theme/theme';

interface PriceChipProps {
  amount: number;
  variant?: 'solid' | 'navy';
}

// Matches .price-chip / .price-chip.navy in the mockup.
export const PriceChip: React.FC<PriceChipProps> = ({ amount, variant = 'solid' }) => (
  <Text style={[styles.chip, variant === 'navy' ? styles.navy : styles.solid]}>₹{amount}</Text>
);

const styles = StyleSheet.create({
  chip: {
    fontWeight: '800',
    fontSize: 11.5,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  solid: {
    backgroundColor: colors.peachPrimary,
    color: colors.white,
  },
  navy: {
    backgroundColor: colors.peachBg,
    color: colors.navyDeep,
    borderWidth: 1.5,
    borderColor: colors.peachPrimary,
  },
});
