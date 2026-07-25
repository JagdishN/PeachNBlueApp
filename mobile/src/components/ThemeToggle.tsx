import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 28;
const KNOB_SIZE = 22;
const KNOB_PADDING = 3;
const KNOB_TRAVEL = TRACK_WIDTH - KNOB_SIZE - KNOB_PADDING * 2;

// Replaces the old Settings-screen light/dark toggle rows — a single icon
// switch reachable directly from the app bar, no navigation trip into
// Settings just to flip the theme. Fixed colors regardless of theme mode
// (same "small, self-contained, always-on-the-dark-chrome-bar" treatment as
// the settings button next to it), not theme-reactive tokens.
export const ThemeToggle: React.FC = () => {
  const { mode, toggleMode } = useTheme();
  const anim = useRef(new Animated.Value(mode === 'light' ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: mode === 'light' ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [mode, anim]);

  const knobLeft = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [KNOB_PADDING, KNOB_PADDING + KNOB_TRAVEL],
  });

  return (
    <Pressable
      style={styles.track}
      onPress={toggleMode}
      accessibilityRole="switch"
      accessibilityState={{ checked: mode === 'light' }}
      accessibilityLabel={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      hitSlop={6}
    >
      <Animated.View style={[styles.knob, { left: knobLeft }]}>
        <MaterialCommunityIcons
          name={mode === 'light' ? 'white-balance-sunny' : 'moon-waning-crescent'}
          size={14}
          color={mode === 'light' ? '#F2A93B' : '#16305C'}
        />
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
  },
  knob: {
    position: 'absolute',
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
});
