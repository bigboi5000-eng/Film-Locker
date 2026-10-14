import { useMemo } from 'react';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

/**
 * A stylesheet that follows the theme.
 *
 * StyleSheet.create at module scope is evaluated once, when the file is
 * imported — long before any hook can run — so a colour written into one of
 * those objects can never change. The way round it is to make the stylesheet
 * a function of the palette and call it during render, which is what this
 * does, memoised so the objects are rebuilt only when the palette actually
 * changes rather than on every render.
 *
 * The factory must be declared at module scope (`const makeStyles = (c) =>
 * StyleSheet.create({...})`), not inline in the component, or its identity
 * changes every render and the memo never hits.
 */
export function useThemedStyles<T>(factory: (colors: Palette) => T): T {
  const colors = useColors();
  return useMemo(() => factory(colors), [factory, colors]);
}
