import { useColorScheme as useSystemScheme } from 'react-native';
import colors, { type Palette } from '@/constants/colors';
import { useThemePreference } from '@/components/ThemeProvider';

/**
 * The palette for the theme in force.
 *
 * "In force" is the user's stored preference where they have expressed one,
 * and the device's setting where they have chosen Automatic — which is the
 * default. The preference lives in a provider rather than being read from
 * storage here, because every styled component calls this and a storage
 * read per call would be both slow and asynchronous.
 *
 * Falls back to the system scheme when no provider is above it. That keeps
 * this usable from anywhere, including trees mounted outside the app root
 * such as an error boundary's fallback, which must not itself be able to
 * crash for want of context.
 */
export function useColors(): Palette {
  const systemScheme = useSystemScheme();
  const preference = useThemePreference();

  const resolved =
    preference === null
      ? systemScheme
      : preference.theme === 'automatic'
        ? preference.systemScheme
        : preference.theme;

  return { ...(resolved === 'dark' ? colors.dark : colors.light), radius: colors.radius };
}

/** True when the dark palette is in force — for status bars and overlays. */
export function useIsDark(): boolean {
  const systemScheme = useSystemScheme();
  const preference = useThemePreference();
  if (preference === null) return systemScheme === 'dark';
  if (preference.theme === 'automatic') return preference.systemScheme === 'dark';
  return preference.theme === 'dark';
}
