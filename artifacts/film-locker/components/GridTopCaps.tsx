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
 * How far past a card's edge each wedge reaches, to take the card's shadow
 * with it. Comfortably over MovieCard's 6px shadow radius, and under the
 * 10px gutter, so one column's overhang never reaches the next card.
 */
const BLEED = 8;

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
 *
 * Each wedge reaches BLEED past the card's own edge, which is what makes
 * the shadow agree with the new shape. A card carries a soft shadow around
 * its outline, and that outline has a SQUARE top corner however round the
 * poster inside it is made to look — so without the overhang the shadow
 * went on tracing the old corner and left a little flick of grey sticking
 * out past the curve. The overhang only ever covers the gutter between
 * columns or the page margin, both of which are this same colour anyway.
 */
export function GridTopCaps() {
  const colors = useColors();

  const d = useMemo(() => {
    const r = GRID_CARD_RADIUS;
    const parts: string[] = [];
    for (let i = 0; i < GRID_COLUMNS; i++) {
      const left = GRID_HORIZONTAL_PADDING + i * (GRID_CARD_WIDTH + GRID_COLUMN_GAP);
      const right = left + GRID_CARD_WIDTH;
      // Sweep 0 turns anticlockwise on screen, 1 clockwise, so each arc
      // follows the corner the card would have had.
      parts.push(
        `M${left - BLEED},0 H${left + r} A${r},${r} 0 0 0 ${left},${r} H${left - BLEED} Z`
      );
      parts.push(
        `M${right + BLEED},0 H${right - r} A${r},${r} 0 0 1 ${right},${r} H${right + BLEED} Z`
      );
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
