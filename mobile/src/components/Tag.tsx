import React from 'react';
import { StyleSheet, Text } from 'react-native';

interface TagProps {
  label: string;
  bg: string;
  color: string;
}

// Matches .service-tag in the mockup — reused for garment service types and
// branch apartment/area tags, each with their own color mapping.
export const Tag: React.FC<TagProps> = ({ label, bg, color }) => (
  <Text style={[styles.tag, { backgroundColor: bg, color }]}>{label}</Text>
);

const styles = StyleSheet.create({
  tag: {
    fontSize: 7.5,
    fontWeight: '800',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 5,
    marginLeft: 6,
    overflow: 'hidden',
  },
});
