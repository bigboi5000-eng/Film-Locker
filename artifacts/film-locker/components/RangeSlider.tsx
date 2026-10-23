/**
 * A two-handled slider over a half-star scale.
 *
 * A single floor can only ask "at least this good", which cannot express
 * "the middling ones" or "show me what I disliked" — both ends have to move
 * for that. So this is a span rather than a threshold: drag either handle,
 * and the band between them is what survives the filter.
 *
 * Not built on StarRating. That control fills up to a value, which is the
 * right picture for a rating and the wrong one for a range — "two to three
 * and a half" is a band in the middle with nothing lit at either end, and a
 * row of stars cannot draw that without lying about what a star means.
 *
 * Deliberately no measurement. The width is given, not discovered: a plain
 * View stretches to its parent, so a measured width is the parent's and not
 * the control's, which is exactly the bug that made the star row read every
 * tap against the wrong geometry. Everything here is computed from `width`
 * before a single frame is laid out.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform, type GestureResponderEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { Palette } from '@/constants/colors';

/** Ten steps of a half, plus nought: the positions a half-star scale has. */
export const STEPS = 10;
export const MAX_VALUE = 5;

export interface RangeSliderProps {
  min: number;
  max: number;
  onChange: (min: number, max: number) => void;
  /** Given rather than measured — see the note at the top of this file. */
  width: number;
  /**
   * The scale, which is half-stars unless told otherwise.
   *
   * Runtime wants the same control over a different range — nought to four
   * hours in ten-minute steps — and a second slider that worked slightly
   * differently would be a second set of bugs. So the geometry takes the
   * scale as numbers rather than assuming the one it was written for.
   */
  maxValue?: number;
  steps?: number;
  /** Where to draw a tick. Defaults to every whole unit of the scale. */
  tickEvery?: number;
}

/** How far down a finger travels before the gesture is read as a scroll. */
const SCROLL_SLOP = 12;

const THUMB = 24;
const TRACK_H = 5;

/** Snap a position along the track to the nearest step on the scale. */
function valueAt(x: number, usable: number, maxValue: number, steps: number): number {
  const ratio = Math.min(Math.max(x / usable, 0), 1);
  return (Math.round(ratio * steps) / steps) * maxValue;
}

export function RangeSlider({
  min,
  max,
  onChange,
  width,
  maxValue = MAX_VALUE,
  steps = STEPS,
  tickEvery = 1,
}: RangeSliderProps) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  // The thumbs are centred on their value, so the travel available to them
  // is the width less one thumb — half a thumb of margin at each end.
  const usable = useMemo(() => Math.max(width - THUMB, 1), [width]);
  const xOf = useCallback((v: number) => (v / maxValue) * usable, [usable, maxValue]);

  /** Which handle the finger took hold of, for the length of the gesture. */
  const holding = useRef<'min' | 'max'>('min');
  const [live, setLive] = useState<{ min: number; max: number } | null>(null);
  const lastStep = useRef(0);

  const shown = live ?? { min, max };

  const pick = useCallback(
    (v: number) => {
      // The nearer handle, and on a tie the one that lets the drag continue
      // in the direction it is going rather than refusing to move.
      const dMin = Math.abs(v - min);
      const dMax = Math.abs(v - max);
      if (dMin === dMax) return v < min ? 'min' : 'max';
      return dMin < dMax ? 'min' : 'max';
    },
    [min, max]
  );

  const apply = useCallback(
    (v: number, which: 'min' | 'max') => {
      // Clamped against the other handle rather than swapped: a handle
      // dragged past its partner stops there, which keeps the one under the
      // finger the one that moves.
      const next =
        which === 'min'
          ? { min: Math.min(v, shown.max), max: shown.max }
          : { min: shown.min, max: Math.max(v, shown.min) };
      if (next.min !== shown.min || next.max !== shown.max) {
        if (Platform.OS !== 'web') void Haptics.selectionAsync();
      }
      return next;
    },
    [shown.min, shown.max]
  );

  /**
   * The track's left edge in page space, captured as the finger goes down.
   *
   * Same reason as StarRating's: Android re-runs hit testing on every
   * ACTION_MOVE and reports locationX against whatever view is under the
   * finger then, not against the view holding the responder. A finger
   * sliding along a track forty pixels tall leaves it constantly, and each
   * time it does the origin moves. pageX minus this is stable wherever the
   * finger goes.
   */
  const originX = useRef(0);
  /** Set once the gesture is clearly a scroll rather than a slide. */
  const verticalRef = useRef(false);
  const startPage = useRef({ x: 0, y: 0 });

  /**
   * Deliberately does NOT return true.
   *
   * Returning true sets React Native's blockNativeResponder, which calls
   * requestDisallowInterceptTouchEvent on every ancestor — and three
   * full-width sliders stacked down a scrolling sheet then make most of
   * that sheet a place where dragging does nothing at all. The sliders do
   * not need it: a vertical ScrollView only intercepts once |deltaY|
   * passes its touch slop, so it was never going to take a sideways slide.
   * StarRating does block, because it is one short row and holding the
   * scroll still while a finger is on it is the behaviour wanted there.
   */
  const onGrant = useCallback(
    (e: GestureResponderEvent) => {
      const { locationX, pageX, pageY } = e.nativeEvent;
      // The one event whose locationX is known to be ours.
      originX.current = pageX - locationX;
      startPage.current = { x: pageX, y: pageY };
      verticalRef.current = false;
      const v = valueAt(locationX - THUMB / 2, usable, maxValue, steps);
      holding.current = pick(v);
      lastStep.current = v;
      setLive(apply(v, holding.current));
    },
    [usable, maxValue, steps, pick, apply]
  );

  const onMove = useCallback(
    (e: GestureResponderEvent) => {
      const x = e.nativeEvent.pageX - originX.current;
      // Decided once: a gesture that set off downwards is the sheet being
      // scrolled, and saying so lets the scroll view have it.
      const dx = Math.abs(e.nativeEvent.pageX - startPage.current.x);
      const dy = Math.abs(e.nativeEvent.pageY - startPage.current.y);
      if (!verticalRef.current && dy > SCROLL_SLOP && dy > dx) verticalRef.current = true;
      const v = valueAt(x - THUMB / 2, usable, maxValue, steps);
      if (v === lastStep.current) return;
      lastStep.current = v;
      setLive(apply(v, holding.current));
    },
    [usable, maxValue, steps, apply]
  );

  const onRelease = useCallback(
    (e: GestureResponderEvent) => {
      const x = e.nativeEvent.pageX - originX.current;
      const v = valueAt(x - THUMB / 2, usable, maxValue, steps);
      const next = apply(v, holding.current);
      setLive(null);
      onChange(next.min, next.max);
    },
    [usable, maxValue, steps, apply, onChange]
  );

  const left = xOf(shown.min);
  const right = xOf(shown.max);

  return (
    <View
      style={{ width, height: THUMB + 10, justifyContent: 'center' }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      // Handed over only for a clearly downward gesture, which is the
      // sheet being scrolled. A sideways slide stays the slider's, even if
      // the finger drifts off the track.
      onResponderTerminationRequest={() => verticalRef.current}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onRelease}
      onResponderTerminate={() => setLive(null)}
    >
      {/* Nothing inside may be a touch target, or locationX would be
          measured from whichever piece the finger landed on instead of from
          the track. */}
      <View pointerEvents="none" style={{ marginLeft: THUMB / 2, width: usable }}>
        <View style={styles.track} />
        <View style={[styles.fill, { left, width: Math.max(right - left, 0) }]} />

        {/* A tick at each round value, so the scale reads without labels. */}
        {Array.from({ length: Math.floor(maxValue / tickEvery) + 1 }, (_, i) => i * tickEvery).map((n) => (
          <View key={n} style={[styles.tick, { left: xOf(n) - 1 }]} />
        ))}

        <View style={[styles.thumb, { left: left - THUMB / 2 }]} />
        <View style={[styles.thumb, { left: right - THUMB / 2 }]} />
      </View>
    </View>
  );
}

/** "2½ – 4", "3+", "≤ 3", or "Any" — whichever the span actually says. */
export function formatRange(min: number, max: number): string {
  const open = min <= 0;
  const full = max >= MAX_VALUE;
  if (open && full) return 'Any';
  const half = (v: number) => {
    const whole = Math.floor(v);
    const isHalf = v - whole >= 0.5;
    if (whole === 0) return '½';
    return isHalf ? `${whole}½` : String(whole);
  };
  if (open) return `up to ${half(max)}`;
  if (full) return `${half(min)}+`;
  return `${half(min)} – ${half(max)}`;
}

const makeStyles = (c: Palette) => StyleSheet.create({
  track: {
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: c.border,
  },
  fill: {
    position: 'absolute',
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: c.primary,
  },
  tick: {
    position: 'absolute',
    top: TRACK_H + 4,
    width: 2,
    height: 4,
    borderRadius: 1,
    backgroundColor: c.borderSubtle,
  },
  thumb: {
    position: 'absolute',
    top: -(THUMB - TRACK_H) / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: c.surface,
    borderWidth: 2,
    borderColor: c.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 2,
    elevation: 3,
  },
});
