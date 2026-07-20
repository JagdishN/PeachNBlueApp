import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { ColorTokens, darkColors, lightColors } from '../theme/theme';

const THEME_MODE_KEY = 'pb_theme_mode';

export type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ColorTokens;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Mirrors AuthContext.tsx's conventions (SecureStore persistence, best-effort
// try/catch that never blocks). Unlike auth, there's no "loading" gate before
// first paint — the default ('light', per the client's confirmed choice)
// renders immediately, and flips to the stored preference once the restore
// resolves. A returning dark-mode user sees a brief light flash before it
// corrects; simpler than adding a second splash-gating condition to App.tsx
// for a preference that isn't security- or correctness-critical.
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>('light');

  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(THEME_MODE_KEY);
        if (stored === 'light' || stored === 'dark') {
          setModeState(stored);
        }
      } catch {
        // SecureStore unavailable (e.g. web) — stay on the 'light' default.
      }
    })();
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    SecureStore.setItemAsync(THEME_MODE_KEY, next).catch(() => {
      // Best-effort persistence — the in-memory mode change still applies
      // for this session even if saving it for next launch fails.
    });
  };

  const toggleMode = () => setMode(mode === 'light' ? 'dark' : 'light');

  const colors = useMemo(() => (mode === 'dark' ? darkColors : lightColors), [mode]);

  return <ThemeContext.Provider value={{ mode, colors, setMode, toggleMode }}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
};
