/**
 * Stars you can slide.
 *
 * Ten positions rather than five, which is why this is its own component:
 * a half-star is not a different icon but a half-width window onto a filled
 * one, laid over an outline of the same size. Ionicons has no half glyph,
 * and the ones in other sets lean the wrong way against a left-to-right
 * fill.
 *
 * Two gestures, deliberately different:
 *
 *  - A tap gives a WHOLE star, always. Hitting the left edge of the fourth
 *    star and getting 3½ is the kind of precision nobody asked a tap for,
 *    and the commonest rating in any five-star system is a round number.
 *  - A drag gives halves, following the finger, like a slider. Precision is
 *    something you opt into by taking the time to slide.
 *
 * The value under the finger is shown as it moves and only committed on
 * release, so a drag across the row does not fire five writes on its way to
 * the one that was meant.
 */
import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, Platform, type GestureResponderEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';

export interface StarRatingProps {
  /** 0.5–5 in half steps, or null/undefined for unrated. */
  value: number | null | undefined;
  /**
   * Omit to render a read-only display. `viaDrag` says how the value was
   * chosen, because tapping a star you already have should be able to mean
   * "clear it" while sliding onto the same value should not.
   */
  onChange?: (rating: number, viaDrag: boolean) => void;
  size?: number;
  /** Gap between stars. The touch maths accounts for it via the row width. */
  gap?: number;
}

/** How far a finger may travel and still count as a tap. */
const TAP_SLOP = 6;

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
  color,
}: {
  index: number;
  value: number;
  size: number;
  color: string;
}) {
  const filled = value >= index;
  const halved = !filled && value >= index - 0.5;

  return (
    <View style={{ width: size, height: size }}>
      <Ionicons name="star-outline" size={size} color={color} />
      {filled || halved ? (
        // Clipped to half the width for a half star. The filled glyph is
        // drawn at full size inside a window showing only its left, so the
        // two always line up — they are the same glyph.
        <View
          style={[StyleSheet.absoluteFill, halved ? { width: size / 2, overflow: 'hidden' } : null]}
        >
          <Ionicons name="star" size={size} color={color} />
        </View>
      ) : null}
    </View>
  );
}

export function StarRating({ value, onChange, size = 28, gap = 6 }: StarRatingProps) {
  const colors = useColors();
  const readOnly = !onChange;

  const [width, setWidth] = useState(0);
  /** What the finger is currently over, while it is down. */
  const [preview, setPreview] = useState<number | null>(null);
  const startX = useRef(0);
  const movedRef = useRef(false);
  const lastStepRef = useRef<number | null>(null);

  const committed = typeof value === 'number' ? value : 0;
  const shown = preview ?? committed;

  /**
   * Where along the row the finger is, as a rating.
   *
   * Measured against the row's own width rather than the stars': it is the
   * only figure available mid-gesture that already accounts for the gaps,
   * and dividing by five gives the slot each star occupies whatever size
   * the caller asked for.
   */
  const ratingAt = useCallback(
    (x: number, halves: boolean): number => {
      if (width <= 0) return 0.5;
      const slot = width / 5;
      const index = Math.min(Math.max(Math.floor(x / slot), 0), 4);
      if (!halves) return index + 1;
      const within = x - index * slot;
      return index + (within < slot / 2 ? 0.5 : 1);
    },
    [width]
  );

  const onGrant = useCallback(
    (e: GestureResponderEvent) => {
      startX.current = e.nativeEvent.locationX;
      movedRef.current = false;
      // A press starts on the whole star under it; sliding refines it.
      const next = ratingAt(e.nativeEvent.locationX, false);
      lastStepRef.current = next;
      setPreview(next);
    },
    [ratingAt]
  );

  const onMove = useCallback(
    (e: GestureResponderEvent) => {
      const x = e.nativeEvent.locationX;
      if (!movedRef.current && Math.abs(x - startX.current) > TAP_SLOP) movedRef.current = true;
      const next = ratingAt(x, movedRef.current);
      if (next !== lastStepRef.current) {
        lastStepRef.current = next;
        setPreview(next);
        // One tick per half-star crossed, which is what makes a slide feel
        // like a dial rather than a drag over a picture of one.
        if (Platform.OS !== 'web') void Haptics.selectionAsync();
      }
    },
    [ratingAt]
  );

  const onRelease = useCallback(
    (e: GestureResponderEvent) => {
      const next = ratingAt(e.nativeEvent.locationX, movedRef.current);
      const viaDrag = movedRef.current;
      setPreview(null);
      onChange?.(next, viaDrag);
    },
    [onChange, ratingAt]
  );

  const row = (
    <View style={[styles.row, { gap }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} index={n} value={shown} size={size} color={colors.star} />
      ))}
    </View>
  );

  if (readOnly) return row;

  return (
    <View
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      // Held once the finger is down, so a slide along the stars is not
      // stolen by the sheet they sit in. Before that it yields freely, so a
      // scroll that merely begins on them still scrolls.
      onResponderTerminationRequest={() => !movedRef.current}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onRelease}
      onResponderTerminate={() => setPreview(null)}
    >
      {row}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
