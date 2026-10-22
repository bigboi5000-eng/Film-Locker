import React, { useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import {
  GRID_CARD_RADIUS,
  GRID_CARD_WIDTH,
  GRID_COLUMNS,
  GRID_COLUMN_GAP,
  GRID_HORIZONTAL_PADDING,
} from '@/components/MovieCard';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/**
 * Rounds off the top of a poster grid, per film rather than per list.
 *
 * A film sliding up out of view is the one moment its own shape is
 * contradicted: the 10px corner it has everywhere else is replaced by a
 * hard horizontal chop. Rounding the scroll container instead only curves
 * the far left and far right of the screen — which is padding, so nothing
 * visible changes, and every card is still cut square.
 *
 * There is no way to draw a concave corner out of plain views: a rounded
 * View paints the disc, and what is wanted here is everything except the
 * disc, over a poster rather than over a flat colour. So this is six small
 * wedges of page background — one at each top corner of each column —
 * painted over the cut line. What is left showing underneath is a card
 * with the corners it should have had.
 */
export function GridTopCaps() {
  const colors = useColors();

  const d = useMemo(() => {
    const r = GRID_CARD_RADIUS;
    const parts: string[] = [];
    for (let i = 0; i < GRID_COLUMNS; i++) {
      const left = GRID_HORIZONTAL_PADDING + i * (GRID_CARD_WIDTH + GRID_COLUMN_GAP);
      const right = left + GRID_CARD_WIDTH;
      // Sweep 0 turns anticlockwise on screen, 1 clockwise, so each wedge
      // closes back on the square corner it is covering up.
      parts.push(`M${left},0 H${left + r} A${r},${r} 0 0 0 ${left},${r} Z`);
      parts.push(`M${right},0 H${right - r} A${r},${r} 0 0 1 ${right},${r} Z`);
    }
    return parts.join(' ');
  }, []);

  return (
    <View pointerEvents="none" style={styles.overlay}>
      <Svg width={SCREEN_WIDTH} height={GRID_CARD_RADIUS}>
        <Path d={d} fill={colors.background} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, height: GRID_CARD_RADIUS },
});
