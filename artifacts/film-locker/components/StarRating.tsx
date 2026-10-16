/**
 * Stars, in halves.
 *
 * Ten positions rather than five, which is the only reason this is its own
 * component: a half-star is not a different icon but a half-width window
 * onto a filled one, laid over an outline of the same size. Ionicons has no
 * half-star glyph, and the ones that exist in other sets lean the wrong way
 * against a left-to-right fill.
 *
 * Reading a tap is the other half of it. The control is not five buttons
 * but ten: each star is two targets, and which half was hit decides whether
 * the value lands on the half or the whole. That has to be measured rather
 * than guessed, so the touch is taken on the row and divided by its width.
 */
import React, { useCallback } from 'react';
import { View, StyleSheet, type GestureResponderEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export interface StarRatingProps {
  /** 0.5–5 in half steps, or null/undefined for unrated. */
  value: number | null | undefined;
  /** Omit to render a read-only display. */
  onChange?: (rating: number) => void;
  size?: number;
  /** Gap between stars. Also the width the touch maths has to account for. */
  gap?: number;
}

/** Round any score onto the nearest half, within 0.5–5. */
export function toHalfStar(value: number): number {
  return Math.min(Math.max(Math.round(value * 2) / 2, 0.5), 5);
}

/** "3½" rather than "3.5" — shorter, and it reads as a rating not a number. */
export function formatStars(value: number | null | undefined): string {
  if (typeof value !== 'number' || value <= 0) return '';
  const whole = Math.floor(value);
  const half = value - whole >= 0.5;
  if (whole === 0) return '½';
  return half ? `${whole}½` : String(whole);
}

function Star({
  index,
  value,
  size,
  colors,
}: {
  index: number;
  value: number;
  size: number;
  colors: ReturnType<typeof useColors>;
}) {
  // How much of this star is filled: all of it, half, or none.
  const filled = value >= index;
  const halved = !filled && value >= index - 0.5;

  return (
    <View style={{ width: size, height: size }}>
      <Ionicons name="star-outline" size={size} color={colors.star} />
      {filled || halved ? (
        // Clipped to half the width for a half star. The filled glyph is
        // drawn at full size inside a window that shows only the left of it,
        // so the two always line up exactly.
        <View
          style={[
            StyleSheet.absoluteFill,
            halved ? { width: size / 2, overflow: 'hidden' } : null,
          ]}
        >
          <Ionicons name="star" size={size} color={colors.star} />
        </View>
      ) : null}
    </View>
  );
}

export function StarRating({ value, onChange, size = 28, gap = 6 }: StarRatingProps) {
  const colors = useColors();
  const current = typeof value === 'number' ? value : 0;
  const readOnly = !onChange;

  /**
   * Which of the ten positions a touch landed on.
   *
   * Measured from the row's own width rather than from the stars': it is the
   * only number available at the moment of the touch that accounts for the
   * gaps, and dividing it by five gives the slot each star occupies whether
   * or not the caller changed the size.
   */
  const handlePress = useCallback(
    (event: GestureResponderEvent, width: number) => {
      if (!onChange || width <= 0) return;
      const x = event.nativeEvent.locationX;
      const slot = width / 5;
      const starIndex = Math.min(Math.floor(x / slot), 4);
      const withinStar = x - starIndex * slot;
      const isLeftHalf = withinStar < slot / 2;
      onChange(starIndex + (isLeftHalf ? 0.5 : 1));
    },
    [onChange]
  );

  const [width, setWidth] = React.useState(0);

  const row = (
    <View
      style={[styles.row, { gap }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} index={n} value={current} size={size} colors={colors} />
      ))}
    </View>
  );

  if (readOnly) return row;

  return (
    <View
      onStartShouldSetResponder={() => true}
      // Yielded on request, so a drag that starts on the stars still scrolls
      // the sheet they sit in rather than being swallowed by them.
      onResponderTerminationRequest={() => true}
      onResponderRelease={(e) => handlePress(e, width)}
    >
      {row}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
