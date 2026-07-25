import React from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { NivenxaFooter } from './BrandComponents';

interface AppScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  backgroundColor?: string;
  contentStyle?: ViewStyle;
}

// Every screen in both the Staff and Admin stacks renders through this
// wrapper so the NIVENXA footer (CLAUDE.md non-negotiable) is a structural
// guarantee rather than something to remember per-screen.
export const AppScreen: React.FC<AppScreenProps> = ({ children, scroll = true, backgroundColor, contentStyle }) => {
  const { colors } = useTheme();
  const resolvedBackgroundColor = backgroundColor ?? colors.peachBg;
  const Body = scroll ? ScrollView : View;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: resolvedBackgroundColor }]} edges={['top', 'left', 'right']}>
      <Body style={styles.body} contentContainerStyle={scroll ? [styles.content, contentStyle] : undefined}>
        {scroll ? children : <View style={[styles.content, contentStyle]}>{children}</View>}
      </Body>
      <NivenxaFooter />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    flex: 1,
    // Without this, react-native-web's CSS flexbox defaults this box's
    // min-height to its content's natural height (the standard flexbox
    // "min-height: auto" floor) — so a screen with a long list inside just
    // grows past the viewport instead of being clipped to it, and any
    // ScrollView further down the tree never gets a bounded box to scroll
    // within. Native (Yoga) doesn't have this floor, so this only ever
    // shows up when running via `expo start --web`.
    minHeight: 0,
  },
  content: {
    padding: 14,
    flexGrow: 1,
    minHeight: 0,
  },
});
