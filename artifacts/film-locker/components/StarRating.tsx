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
import React, { useCallback, useMemo, useRef, useState } from 'react';
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
  /**
   * Let the control reach nought, for a filter where nought means "any".
   *
   * A rating cannot be nought — a film is unrated or it is scored — so the
   * rating control starts at a half. A threshold can be, and needs to be
   * draggable back to it rather than only clearable by some control sitting
   * beside the slider.
   */
  allowZero?: boolean;
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

export function StarRating({
  value,
  onChange,
  size = 28,
  gap = 6,
  allowZero = false,
}: StarRatingProps) {
  const colors = useColors();
  const readOnly = !onChange;

  /** What the finger is currently over, while it is down. */
  const [preview, setPreview] = useState<number | null>(null);
  const startX = useRef(0);
  const movedRef = useRef(false);
  const lastStepRef = useRef<number | null>(null);

  const committed = typeof value === 'number' ? value : 0;
  const shown = preview ?? committed;

  /**
   * Exactly as wide as the five stars, and no wider.
   *
   * This is load-bearing rather than cosmetic. The row was measured with
   * onLayout and the width divided by five, which is wrong whenever the row
   * is wider than its contents — and it always was, because a plain View
   * stretches to its parent. On a phone that made each "slot" about 68px
   * against a star of 34, so tapping the third star gave two, the fifth
   * gave three, and four and five could not be reached at all.
   *
   * Pinning the width to the stars' own geometry fixes it and removes the
   * measurement entirely: the position of every star is known from `size`
   * and `gap` before anything is laid out, so the first tap is as accurate
   * as the hundredth and there is no frame where the row has no width yet.
   */
  const contentWidth = useMemo(() => size * 5 + gap * 4, [size, gap]);

  /** Where along the row the finger is, as a rating. */
  const ratingAt = useCallback(
    (x: number, halves: boolean): number => {
      const stride = size + gap;
      // The far left quarter of the first star is nought, where that is a
      // value at all. It costs that star a little of its half-zone and buys
      // a threshold you can drag all the way off, which is the thing people
      // reach for first when a filter is too strict.
      if (allowZero && x < size / 4) return 0;
      const index = Math.min(Math.max(Math.floor(x / stride), 0), 4);
      if (!halves) return index + 1;
      // Distance into this star. A touch landing in the gap after a star
      // counts as its right half, which is the whole star — the gap is
      // nearer the star behind it than the one ahead.
      const within = x - index * stride;
      return index + (within < size / 2 ? 0.5 : 1);
    },
    [size, gap, allowZero]
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
    <View style={[styles.row, { gap, width: contentWidth }]}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} index={n} value={shown} size={size} color={colors.star} />
      ))}
    </View>
  );

  if (readOnly) return row;

  return (
    <View
      // Hugging the stars, so the touch coordinates this reports are
      // relative to the first star rather than to whatever the parent's
      // width happens to be.
      style={{ width: contentWidth }}
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
