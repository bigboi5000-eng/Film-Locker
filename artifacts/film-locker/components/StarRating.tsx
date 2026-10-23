/**
 * Stars you can slide.
 *
 * Ten positions rather than five, which is why this is its own component:
 * a half-star is not a different icon but a half-width window onto a filled
 * one, laid over an outline of the same size. Ionicons has no half glyph,
 * and the ones in other sets lean the wrong way against a left-to-right
 * fill.
 *
 * Where your finger is IS the rating, whether it taps or slides. Ten zones
 * of equal width, each half a star.
 *
 * A tap used to give a whole star always, on the reasoning that nobody asks
 * a tap for half-star precision. In practice that left a half reachable
 * only by sliding, so when sliding was broken there was no way to give one
 * at all — and being unable to say three and a half is worse than
 * occasionally meaning four and getting it on the second try. The value
 * under the finger is shown before it is committed either way, so a tap
 * that lands on the wrong side of a star can be slid onto the right one
 * without lifting.
 *
 * The value is only committed on release, so a drag across the row does not
 * fire five writes on its way to the one that was meant.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  /**
   * Fired as a gesture begins and ends, so a scrolling parent can hold
   * still while the finger is on the stars.
   *
   * Refusing the responder is not enough on Android: a native scroll view
   * does not ASK for the gesture, it takes it and tells JS afterwards, so
   * the only reliable way to keep a drag is for the scroll view not to be
   * scrolling in the first place. The cost is that a scroll begun exactly
   * on the stars does not scroll — which is how every slider behaves, and
   * the row is barely thirty pixels tall.
   */
  onInteractionChange?: (active: boolean) => void;
}

/** How far a finger may travel and still count as a tap. */
const TAP_SLOP = 6;

/**
 * How far down a finger must travel before the gesture is read as a scroll
 * rather than a rating. Higher than TAP_SLOP on purpose: a tap on a phone
 * always drifts a little, and reading that drift as a scroll is what made
 * tapping a star do nothing at all.
 */
const SCROLL_SLOP = 12;

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
  onInteractionChange,
}: StarRatingProps) {
  const colors = useColors();
  const readOnly = !onChange;

  /** What the finger is currently over, while it is down. */
  const [preview, setPreview] = useState<number | null>(null);
  /**
   * What was just chosen, held until the owner's `value` catches up.
   *
   * Saving a rating is a round trip, and `value` does not change until it
   * comes back. Without this the stars empty the instant the finger lifts
   * and refill a moment later, which reads as the rating being rejected and
   * then reinstated — the single most alarming thing a control can do right
   * after you have used it.
   */
  const [held, setHeld] = useState<number | null>(null);
  const startX = useRef(0);
  const startPage = useRef({ x: 0, y: 0 });
  /**
   * The container's left edge in page space, captured once as the finger
   * goes down. Every x after that is derived from it.
   *
   * locationX cannot be used for a drag on Android, and this is the whole
   * of why the stars jumped about instead of following the finger.
   * JSTouchDispatcher re-runs hit testing on EVERY ACTION_MOVE
   * (`findTargetTagAndSetCoordinates(ev)`) and fills targetCoordinates
   * with the position "in the target view" — the view under the finger at
   * that instant — while still dispatching the event to the view that
   * holds the responder. So locationX is measured from whatever happens to
   * be under your finger, which is only this control while the finger
   * stays inside it. The row is twenty-eight pixels tall; a sideways slide
   * strays above or below it constantly, and each time it does the origin
   * jumps to some ancestor's left edge and the rating leaps.
   *
   * It is also why the private row escaped. Its container sits in a block,
   * so its left edge and its parent's are the same place and the jump is
   * nearly nothing. The community row has a label beside it, putting its
   * left edge some hundred and fifty pixels in — the better part of the
   * control's own width, so a stray pixel of vertical drift threw the
   * rating anywhere.
   *
   * pageX is relative to the root view and means the same thing in every
   * event, so this origin plus pageX is exact however far the finger
   * wanders.
   */
  const originX = useRef(0);
  /** Set once the gesture is clearly a scroll rather than a rating. */
  const verticalRef = useRef(false);
  const movedRef = useRef(false);
  const lastStepRef = useRef<number | null>(null);
  const heldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const committed = typeof value === 'number' ? value : 0;
  const shown = preview ?? held ?? committed;

  /**
   * Let go of the held value as soon as the owner reports anything new,
   * whatever it is — the save landed, or it failed and the old value came
   * back. Either way the owner is now the authority and this must not keep
   * overriding it.
   */
  const lastValue = useRef(value);
  useEffect(() => {
    if (lastValue.current !== value) {
      lastValue.current = value;
      setHeld(null);
    }
  }, [value]);

  // And a backstop, so a save that never resolves cannot leave the stars
  // showing a rating that was never stored.
  useEffect(() => () => {
    if (heldTimer.current) clearTimeout(heldTimer.current);
  }, []);

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
    (x: number): number => {
      const stride = size + gap;
      // The far left quarter of the first star is nought, where that is a
      // value at all. It costs that star a little of its half-zone and buys
      // a threshold you can drag all the way off, which is the thing people
      // reach for first when a filter is too strict.
      if (allowZero && x < size / 4) return 0;
      // Shifted by half a gap, which makes every step the same width.
      //
      // Measured raw, a half occupied the left of the glyph (size / 2) and
      // a whole occupied the right of the glyph PLUS the gap after it
      // (size / 2 + gap) — so on a 28px star with a 6px gap, halves were
      // 14px and wholes 20px, and a half was half again as hard to hit as
      // a whole. That is most of what "cannot accurately select a half"
      // feels like.
      //
      // With the shift, each of the ten steps is exactly stride / 2, and
      // the boundary between a half and a whole falls precisely on the
      // star's own midpoint rather than three pixels to its right. The gap
      // is split between the stars either side of it instead of belonging
      // entirely to the one behind.
      const shifted = x + gap / 2;
      const index = Math.min(Math.max(Math.floor(shifted / stride), 0), 4);
      const within = shifted - index * stride;
      return index + (within < stride / 2 ? 0.5 : 1);
    },
    [size, gap, allowZero]
  );

  /**
   * Returns true, and that return value is the whole fix for a drag that
   * dies halfway.
   *
   * React Native reads what onResponderGrant returns and passes it to
   * UIManager.setJSResponder as blockNativeResponder — in the renderer:
   * `blockHostResponder = (true === executeDirectDispatch(grantEvent))`.
   * When it is true, Android calls requestDisallowInterceptTouchEvent on
   * every ancestor, and the enclosing ScrollView cannot intercept the
   * gesture at any point. When it is false — which is what a callback
   * returning undefined means — the ScrollView is free to claim the drag
   * the moment the finger passes its touch slop, and JS finds out via
   * onResponderTerminate, with the rating abandoned wherever it had got to.
   *
   * That is why taps were fine and slides were not: a tap never travels
   * far enough for the ScrollView to want it. scrollEnabled={!starActive}
   * was covering for this, but it is a React state change racing a native
   * gesture recogniser, and it only has to lose once.
   */
  const onGrant = useCallback(
    (e: GestureResponderEvent): boolean => {
      const { locationX, pageX, pageY } = e.nativeEvent;
      // ACTION_DOWN is the one moment locationX is known to be ours: the
      // finger is inside this view, because that is how the gesture was
      // granted in the first place. So this is the only chance to learn
      // where the view's left edge is, and after this nothing reads
      // locationX again.
      originX.current = pageX - locationX;
      startX.current = locationX;
      startPage.current = { x: pageX, y: pageY };
      verticalRef.current = false;
      movedRef.current = false;
      onInteractionChange?.(true);
      const next = ratingAt(locationX);
      lastStepRef.current = next;
      setPreview(next);
      return true;
    },
    [ratingAt, onInteractionChange]
  );

  const onMove = useCallback(
    (e: GestureResponderEvent) => {
      const x = e.nativeEvent.pageX - originX.current;
      const dx = Math.abs(e.nativeEvent.pageX - startPage.current.x);
      const dy = Math.abs(e.nativeEvent.pageY - startPage.current.y);
      // Once, and it stays decided: a gesture that set off downwards is a
      // scroll even if it wanders sideways later, and one that set off
      // along the stars stays theirs even if the finger drifts off the row.
      if (!verticalRef.current && !movedRef.current && dy > SCROLL_SLOP && dy > dx) {
        verticalRef.current = true;
      }
      if (!movedRef.current && Math.abs(x - startX.current) > TAP_SLOP) movedRef.current = true;
      const next = ratingAt(x);
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
      // ACTION_UP re-runs the same hit test ACTION_MOVE does, so the
      // release has to come from page space too or a rating can be thrown
      // off by the last pixel of the gesture alone.
      const next = ratingAt(e.nativeEvent.pageX - originX.current);
      // Still tracked, because tapping the score you already have clears it
      // while sliding onto it does not.
      const viaDrag = movedRef.current;
      onInteractionChange?.(false);
      setPreview(null);
      setHeld(next);
      if (heldTimer.current) clearTimeout(heldTimer.current);
      heldTimer.current = setTimeout(() => setHeld(null), 5000);
      onChange?.(next, viaDrag);
    },
    [onChange, ratingAt, onInteractionChange]
  );

  const row = (
    <View
      style={[styles.row, { gap, width: contentWidth, flexShrink: 0 }]}
      // Load-bearing, and the reason taps landed on the wrong star even
      // after the row stopped measuring itself.
      //
      // locationX is relative to the TOUCH TARGET, and the target is the
      // deepest view under the finger when it went down — a plain child
      // View with no handlers is a perfectly good target. Each star is such
      // a View, so pressing the fourth star reported an x of 0-28 measured
      // from the FOURTH STAR'S left edge, which reads as a position inside
      // the first one. Every tap on stars two to five came back as one star,
      // and a drag could only ever reach a half or a whole, because the
      // whole gesture was being measured against a single star's width.
      //
      // Android resolves that target on ACTION_DOWN and dispatches every
      // later event to it, so one wrong press skewed a whole gesture rather
      // than just its first frame. It does NOT reuse the origin, though —
      // see originX above, which is the reason nothing here reads locationX
      // after the grant.
      //
      // `none` means "this view and its children can't be the target", so
      // the responder below is, and x is measured from the row's own left
      // edge — which is what the maths here has always assumed.
      //
      // Worth knowing before trying to reproduce this in a browser: you
      // cannot. react-native-web measures locationX against currentTarget,
      // the responder, so on web the old code was already correct and the
      // stars behaved perfectly. Only the native platforms hand back a
      // target-relative x, and that is where this was only ever visible.
      pointerEvents="none"
    >
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
      //
      // flexShrink: 0 is the load-bearing half of that. A flex child
      // shrinks by default, so a parent ROW — a label beside the stars, say
      // — squeezes this container below contentWidth whenever the two do
      // not both fit, while the touch maths goes on computing against the
      // full width. The stars then sit closer together than the maths
      // believes and every tap lands short: on a 320dp screen the second
      // star reads as one and a half, the third as two and a half, the
      // fifth as four.
      //
      // That is why the community rating "glitched at every half" while the
      // private one, which sits in a block and is never squeezed, behaved.
      // The control was identical; its container was not. Refusing to
      // shrink makes the geometry true wherever this is used, and the
      // caller's label can be the thing that gives way instead.
      style={{ width: contentWidth, flexShrink: 0 }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      // Answered by DIRECTION, not by whether the finger has moved yet.
      //
      // This used to yield whenever the gesture had not already travelled
      // sideways — meaning a tap, which by definition has not — so the
      // scroll view these stars sit in could ask for the gesture mid-tap,
      // be given it, and the release would never arrive. Tapping a star in
      // the film sheet did nothing whatever. The same control inside the
      // filter worked perfectly, because nothing there competes for the
      // gesture; that split is what gave it away.
      //
      // A tap and a sideways drag are the stars' own, and are kept. Only a
      // clearly downward gesture is a scroll, and only that is handed over.
      onResponderTerminationRequest={() => verticalRef.current}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onRelease}
      onResponderTerminate={() => {
        onInteractionChange?.(false);
        setPreview(null);
      }}
    >
      {row}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
