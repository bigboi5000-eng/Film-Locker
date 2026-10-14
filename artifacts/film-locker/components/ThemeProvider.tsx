/**
 * The chosen theme, and where it is remembered.
 *
 * Three settings rather than a switch: Light, Dark, and Automatic, which
 * follows the device. Automatic is the default, so the app matches the phone
 * until somebody says otherwise — and a preference, once set, has to outlive
 * the process, which is what AsyncStorage is for here.
 *
 * The provider also carries the system scheme, so useColors can resolve
 * Automatic without every styled component subscribing to appearance changes
 * separately.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'theme-preference';

export type ThemeChoice = 'light' | 'dark' | 'automatic';

export interface ThemePreference {
  /** What the user chose. */
  theme: ThemeChoice;
  /** What the device is currently set to, for resolving "automatic". */
  systemScheme: 'light' | 'dark';
}

interface ThemeContextValue extends ThemePreference {
  setTheme: (choice: ThemeChoice) => void;
  /** False until the stored choice has been read back. */
  ready: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'automatic';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [theme, setThemeState] = useState<ThemeChoice>('automatic');
  const [ready, setReady] = useState(false);

  // Read the stored choice once. Until it arrives the app renders on
  // Automatic, which is both the default and the least surprising thing to
  // show for the handful of frames involved.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        if (isChoice(raw)) setThemeState(raw);
      })
      .catch(() => {
        // A failed read costs the stored preference for this launch and
        // nothing else; Automatic is a safe place to land.
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  const setTheme = useCallback((choice: ThemeChoice) => {
    // Applied immediately and written in the background: the switch should
    // not wait on storage, and a failed write costs the choice at next
    // launch rather than now.
    setThemeState(choice);
    AsyncStorage.setItem(STORAGE_KEY, choice).catch(() => {});
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, systemScheme, setTheme, ready }),
    [theme, systemScheme, setTheme, ready]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The preference, or null when no provider is above the caller. */
export function useThemePreference(): ThemePreference | null {
  const ctx = useContext(ThemeContext);
  return ctx ? { theme: ctx.theme, systemScheme: ctx.systemScheme } : null;
}

/**
 * The full control, for the setting itself. Throws where the provider is
 * missing, because a toggle that silently fails to persist is worse than a
 * crash in development.
 */
export function useThemeControl(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeControl must be used inside ThemeProvider');
  return ctx;
}
