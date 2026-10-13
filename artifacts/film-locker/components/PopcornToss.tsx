/**
 * PopcornToss — something to do while a film is being identified.
 *
 * Swipe a kernel into the tub. A fan blows across the play area and gets
 * stronger the better you do, and the tub's mouth narrows as the score
 * climbs, so it stays winnable while getting harder.
 *
 * The rule that shapes everything here: identification finishing does NOT
 * interrupt a throw. If a kernel is in the air when the result lands, it
 * flies out and the screen changes when it comes down — being yanked out
 * mid-throw is worse than never having had the game. If nothing is in the
 * air, there is nothing to wait for and it leaves at once.
 *
 * Deliberately built from plain views, one gradient the app already ships,
 * and React Native's own Animated: no new dependency, no image assets, and
 * the kernel and tub are shapes rather than sprites. The whole thing is a few
 * kilobytes of JavaScript and changes the native binary not at all.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  Platform,
  type GestureResponderEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

const HIGH_SCORE_KEY = 'popcorn-toss-high-score';

// A fixed play area, centred. Fixing it avoids measuring layout and keeps
// the physics in one coordinate space that behaves the same on every phone.
const PLAY_W = 300;
const PLAY_H = 360;

const KERNEL = 20;
const LAUNCH_X = PLAY_W / 2;
const LAUNCH_Y = PLAY_H - 48;

/** The plane the kernel has to cross to score: the top of the tub's mouth. */
const BUCKET_Y = 148;
/** How far the drawn tub overhangs its opening on each side. */
const RIM_INSET = 9;
/** How high the popcorn mounds above the rim. */
const HEAP_RISE = 20;

/**
 * The opening narrows with the score. Wind alone turns out not to make this
 * harder — a lower, flatter arc cancels most of the drift, so a player who
 * has found the range keeps scoring however hard it blows. Shrinking the
 * target does make it harder, and unlike wind the player can see it happen.
 */
const MOUTH_HALF_BASE = 50;
const MOUTH_HALF_STEP = 2.5;
const MOUTH_HALF_MIN = 32;

const GRAVITY = 1800; // px/s²

/**
 * Launch speed is a soft-saturating curve over flick speed, not a clamp.
 *
 * The first pass took the flick's vertical and horizontal speeds and clamped
 * each on its own. Simulating that against a player who aims well showed why
 * it felt wrong: past about 1.2px/ms the vertical component pinned to its
 * limit while the horizontal was still free, so every hard flick came out at
 * roughly the same 21° regardless of the direction it was actually aimed,
 * and crossing the clamp swung the launch angle about on its own. Under a
 * reasonable amount of human slop it scored 48%, and the half it lost were
 * throws that simply did not go where they were pointed.
 *
 * Here the flick's direction is kept exactly (clamped only at MAX_ANGLE from
 * vertical) and only the magnitude is compressed, so a harder flick is always
 * a little faster but never jumps. Over the same sweep that scores 70% at the
 * start, easing to about 50% by the tenth catch as the mouth closes — the
 * earlier flat 48% was difficulty coming from the controls, which is the kind
 * nobody enjoys.
 *
 * The top of the curve is set by the play area rather than by feel: a launch
 * much above 1030px/s arcs over the top edge and the kernel vanishes for half
 * its flight. MAX_ANGLE is then whatever still reaches the mouth at that
 * speed with room to spare, which is more lead than the strongest wind needs.
 */
const MIN_SPEED = 560;
const MAX_SPEED = 1030;
const SPEED_K = 1100;
const MAX_ANGLE = (32 * Math.PI) / 180;

/** Below this, the flick was a fumble rather than a throw. */
const FUMBLE_SPEED = 420;

/**
 * Velocity is measured over a window of touch samples, not read off the
 * gesture at release. PanResponder's own vx/vy comes from the last two touch
 * events, which on a fast flick are a couple of milliseconds apart and vary
 * wildly between frames — the same flick could come out 30% faster or slower.
 * Averaging the last ~110ms of travel is far steadier, and it is what the
 * aim guide is drawn from, so the player sees the number being used.
 */
const SAMPLE_WINDOW_MS = 110;
/** A finger that stopped before lifting is a drag, not a throw. */
const STALE_RELEASE_MS = 90;

const MAX_FLIGHT_MS = 4000; // a throw that goes nowhere still has to end
/** A beat after the kernel settles, so the score lands before the screen changes. */
const LEAVE_DELAY_MS = 420;

const AIM_DOTS = 7;

/** Wind grows with the score. */
function windForScore(score: number): number {
  const strength = Math.min(70 + score * 55, 420);
  return Math.random() < 0.5 ? -strength : strength;
}

function mouthHalfForScore(score: number): number {
  return Math.max(MOUTH_HALF_BASE - score * MOUTH_HALF_STEP, MOUTH_HALF_MIN);
}

/** Where the tub sits this round — never so near the edge it is unfair. */
function bucketXForScore(score: number, mouthHalf: number): number {
  const margin = mouthHalf + RIM_INSET + 14;
  const spread = Math.min(0.3 + score * 0.12, 1);
  const centre = PLAY_W / 2;
  const reach = (PLAY_W / 2 - margin) * spread;
  return centre + (Math.random() * 2 - 1) * reach;
}

/**
 * Turn a flick into a launch: direction as thrown, magnitude compressed.
 * Returns null for anything that was not a throw upwards.
 */
function launchFromFlick(vx: number, vy: number): { vx: number; vy: number } | null {
  if (vy >= 0) return null;
  const raw = Math.sqrt(vx * vx + vy * vy);
  if (raw < FUMBLE_SPEED) return null;
  const angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, Math.atan2(vx, -vy)));
  const speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * (1 - Math.exp(-raw / SPEED_K));
  return { vx: Math.sin(angle) * speed, vy: -Math.cos(angle) * speed };
}

/** The popcorn mound, in order of appearance — it grows as the score does. */
const HEAP_PIECES: Array<{ x: number; y: number; r: number; rot: number; butter?: boolean }> = [
  { x: -0.18, y: 0.1, r: 11, rot: -12 },
  { x: 0.22, y: 0.16, r: 10, rot: 18, butter: true },
  { x: -0.55, y: 0.42, r: 9, rot: 8 },
  { x: 0.58, y: 0.46, r: 8.5, rot: -20 },
  { x: 0.02, y: 0.58, r: 9, rot: 26, butter: true },
  { x: -0.36, y: 0.72, r: 8, rot: -6 },
  { x: 0.42, y: 0.76, r: 8, rot: 14 },
  { x: -0.74, y: 0.82, r: 7, rot: 22 },
  { x: 0.76, y: 0.84, r: 7, rot: -14, butter: true },
];

export interface PopcornTossProps {
  /** True once identification has finished and the results are waiting. */
  ready: boolean;
  /** Leave the game. Called only when nothing is mid-flight. */
  onDone: () => void;
}

export function PopcornToss({ ready, onDone }: PopcornTossProps) {
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [wind, setWind] = useState(() => windForScore(0));
  const [mouthHalf, setMouthHalf] = useState(() => mouthHalfForScore(0));
  const [bucketX, setBucketX] = useState(() => bucketXForScore(0, mouthHalfForScore(0)));
  const [flying, setFlying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Position is animated rather than held in state: a React render per frame
  // for sixty frames a second is how this would end up stuttering.
  const x = useRef(new Animated.Value(LAUNCH_X)).current;
  const y = useRef(new Animated.Value(LAUNCH_Y)).current;
  const spin = useRef(new Animated.Value(0)).current;

  // The aim guide. Driven imperatively for the same reason as the kernel:
  // touch moves arrive as fast as frames do, and seven dots through React
  // state would be seven re-renders a frame.
  const dots = useRef(
    Array.from({ length: AIM_DOTS }, () => new Animated.ValueXY({ x: -60, y: -60 }))
  ).current;
  const aimOpacity = useRef(new Animated.Value(0)).current;

  // Mirrors of state for the animation loop and the pan handler, which both
  // read them from closures created before the latest render.
  const flyingRef = useRef(false);
  const windRef = useRef(wind);
  const bucketXRef = useRef(bucketX);
  const mouthHalfRef = useRef(mouthHalf);
  const frameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  /**
   * The exit callback, mirrored.
   *
   * The caller hands over a closure around its own state, so its identity
   * changes the moment the result arrives. The animation loop is holding a
   * closure made when the throw started — before that — so calling onDone
   * through it would call the version that still thinks nothing has been
   * identified, and the game would sit there forever. Everything calls the
   * current one through this.
   */
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => { windRef.current = wind; }, [wind]);
  useEffect(() => { bucketXRef.current = bucketX; }, [bucketX]);
  useEffect(() => { mouthHalfRef.current = mouthHalf; }, [mouthHalf]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  // Load the high score. A failure here costs the number on screen, nothing
  // else, so it is swallowed rather than surfaced mid-game.
  useEffect(() => {
    AsyncStorage.getItem(HIGH_SCORE_KEY)
      .then((raw) => {
        const parsed = Number(raw);
        if (mountedRef.current && Number.isFinite(parsed) && parsed > 0) setHighScore(parsed);
      })
      .catch(() => {});
  }, []);

  const saveHighScore = useCallback((value: number) => {
    setHighScore(value);
    AsyncStorage.setItem(HIGH_SCORE_KEY, String(value)).catch(() => {});
  }, []);

  /**
   * Leaving is driven by state, not called from the landing code.
   *
   * Either order can happen — the result can arrive while the player is
   * looking at the screen, or while a kernel is still in the air — and both
   * come down to the same condition. Expressing it as an effect on that
   * condition means the second case is handled by `flying` going false,
   * rather than by the animation loop remembering to check.
   */
  useEffect(() => {
    if (!ready || flying) return;
    const timer = setTimeout(() => onDoneRef.current(), LEAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, flying]);

  const resetKernel = useCallback(() => {
    x.setValue(LAUNCH_X);
    y.setValue(LAUNCH_Y);
    spin.setValue(0);
  }, [x, y, spin]);

  /**
   * A catch is scored the instant the kernel crosses the mouth's plane, which
   * is the rim's top edge — so without this it would wink out while still
   * clearly above the tub. Dropping it the depth of the rim first, with the
   * tub drawn over the top, is what it looks like to land in there.
   */
  const sinkIntoBucket = useCallback(
    (done: () => void) => {
      Animated.timing(y, {
        toValue: BUCKET_Y + 26,
        duration: 130,
        useNativeDriver: false,
      }).start(done);
    },
    [y]
  );

  /** Fresh wind, a fresh position and a narrower mouth for the next throw. */
  const nextRound = useCallback((nextScore: number) => {
    const half = mouthHalfForScore(nextScore);
    setMouthHalf(half);
    setWind(windForScore(nextScore));
    setBucketX(bucketXForScore(nextScore, half));
  }, []);

  const land = useCallback(
    (hit: boolean) => {
      flyingRef.current = false;
      if (!mountedRef.current) return;
      setFlying(false);

      const nextScore = hit ? score + 1 : score;
      if (hit) {
        setScore(nextScore);
        if (nextScore > highScore) saveHighScore(nextScore);
        setMessage('In!');
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        // The tub stays put until the kernel is out of sight inside it —
        // moving it the moment the catch scores would leave the kernel
        // sinking into thin air.
        sinkIntoBucket(() => {
          if (!mountedRef.current) return;
          resetKernel();
          nextRound(nextScore);
        });
        return;
      }

      setMessage('Missed');
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      resetKernel();
      nextRound(nextScore);
    },
    [score, highScore, saveHighScore, resetKernel, sinkIntoBucket, nextRound]
  );

  /** Integrate the throw frame by frame until it lands or leaves the area. */
  const launch = useCallback(
    (vx0: number, vy0: number) => {
      if (flyingRef.current) return;
      flyingRef.current = true;
      setFlying(true);
      setMessage(null);

      let px = LAUNCH_X;
      let py = LAUNCH_Y;
      let vx = vx0;
      let vy = vy0;
      let turn = 0;
      let last = Date.now();
      const startedAt = last;

      const step = () => {
        if (!mountedRef.current) return;
        const now = Date.now();
        // Clamped: a backgrounded app returns with an enormous delta, which
        // would teleport the kernel straight through the tub.
        const dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;

        const prevY = py;
        vx += windRef.current * dt;
        vy += GRAVITY * dt;
        px += vx * dt;
        py += vy * dt;
        turn += (vx * 0.55 + 90) * dt;

        x.setValue(px);
        y.setValue(py);
        spin.setValue(turn);

        // Falling across the mouth's plane, within its opening, is a goal.
        const crossedMouth = prevY <= BUCKET_Y && py > BUCKET_Y;
        if (vy > 0 && crossedMouth && Math.abs(px - bucketXRef.current) <= mouthHalfRef.current) {
          land(true);
          return;
        }

        const offScreen = py > PLAY_H + KERNEL || px < -KERNEL || px > PLAY_W + KERNEL;
        if (offScreen || now - startedAt > MAX_FLIGHT_MS) {
          land(false);
          return;
        }

        frameRef.current = requestAnimationFrame(step);
      };

      frameRef.current = requestAnimationFrame(step);
    },
    [x, y, spin, land]
  );

  // PanResponder rather than a gesture library: this lives inside a modal,
  // it is one flick, and the built-in one needs no provider above it.
  const pan = useMemo(() => {
    /** Recent touch points, newest last, trimmed to the averaging window. */
    const samples: Array<{ x: number; y: number; t: number }> = [];

    const note = (evt: GestureResponderEvent) => {
      const now = Date.now();
      samples.push({ x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY, t: now });
      while (samples.length > 2 && now - samples[0].t > SAMPLE_WINDOW_MS) samples.shift();
    };

    /** Average velocity across the window, in px/s. */
    const velocity = (): { vx: number; vy: number } | null => {
      if (samples.length < 2) return null;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = (last.t - first.t) / 1000;
      if (dt < 0.008) return null;
      return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
    };

    const hideAim = () => aimOpacity.setValue(0);

    /**
     * Draw where this flick would go, as it is being made.
     *
     * Wind is deliberately left out of the prediction: the guide shows what
     * the player controls, and reading the wind is the skill the game is
     * actually asking for. The dots stop short of the mouth for the same
     * reason — this is the shape of the throw, not a crosshair.
     */
    const showAim = (vx: number, vy: number) => {
      const launched = launchFromFlick(vx, vy);
      if (!launched) {
        hideAim();
        return;
      }
      // How long until it crosses the mouth's plane, or failing that, falls
      // back past the launch line.
      const rise = LAUNCH_Y - BUCKET_Y;
      const disc = launched.vy * launched.vy - 2 * GRAVITY * rise;
      const tEnd =
        disc > 0
          ? (-launched.vy + Math.sqrt(disc)) / GRAVITY
          : (-2 * launched.vy) / GRAVITY;
      const span = tEnd * 0.62;
      for (let i = 0; i < AIM_DOTS; i++) {
        const t = (span * (i + 1)) / AIM_DOTS;
        dots[i].setValue({
          x: LAUNCH_X + launched.vx * t,
          y: LAUNCH_Y + launched.vy * t + 0.5 * GRAVITY * t * t,
        });
      }
      aimOpacity.setValue(1);
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => !flyingRef.current,
      onMoveShouldSetPanResponder: () => !flyingRef.current,
      onPanResponderGrant: (evt) => {
        samples.length = 0;
        note(evt);
        hideAim();
      },
      onPanResponderMove: (evt) => {
        if (flyingRef.current) return;
        note(evt);
        const v = velocity();
        if (v) showAim(v.vx, v.vy);
        else hideAim();
      },
      onPanResponderRelease: (evt) => {
        note(evt);
        hideAim();
        if (flyingRef.current) return;

        const v = velocity();
        const lastSample = samples[samples.length - 1];
        const secondLast = samples[samples.length - 2];
        // A finger that came to rest before lifting was dragging, not
        // throwing. Without this, resting a fingertip on the screen and
        // lifting it launches a kernel.
        const stale = !secondLast || lastSample.t - secondLast.t > STALE_RELEASE_MS;
        if (!v || stale) return;

        const launched = launchFromFlick(v.vx, v.vy);
        if (!launched) {
          if (v.vy < 0) setMessage('Swipe up harder');
          return;
        }
        launch(launched.vx, launched.vy);
      },
      onPanResponderTerminate: () => hideAim(),
    });
  }, [launch, dots, aimOpacity]);

  const bucketW = (mouthHalf + RIM_INSET) * 2;
  const bucketH = Math.round(bucketW * 0.58);
  const heapPieces = HEAP_PIECES.slice(0, Math.min(3 + score, HEAP_PIECES.length));
  const windLabel = Math.max(Math.round(Math.abs(wind) / 70), 1);

  return (
    <View style={styles.wrap}>
      <View style={styles.scoreRow}>
        <Text style={styles.score}>{score}</Text>
        <Text style={styles.best}>best {Math.max(highScore, score)}</Text>
      </View>

      <View style={styles.play} {...pan.panHandlers}>
        <LinearGradient
          colors={['#FFFDF6', '#FFF1D6']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* The counter the kernel is flicked off. */}
        <View style={styles.floor} pointerEvents="none">
          <LinearGradient
            colors={['#F3DFB8', '#E7CE9F']}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>
        <View style={styles.launchPad} pointerEvents="none" />

        {/*
          The kernel is drawn BEFORE the tub, so it passes behind it. That is
          what sells a catch: a kernel crossing the mouth disappears into the
          tub rather than sliding across its front, and it costs nothing.
        */}
        <Animated.View
          style={[
            styles.kernel,
            {
              transform: [
                { translateX: Animated.subtract(x, KERNEL / 2) },
                { translateY: Animated.subtract(y, KERNEL / 2) },
                {
                  rotate: spin.interpolate({
                    inputRange: [-360, 360],
                    outputRange: ['-360deg', '360deg'],
                  }),
                },
              ],
            },
          ]}
          pointerEvents="none"
        >
          <View style={[styles.puff, styles.puffA]} />
          <View style={[styles.puff, styles.puffB]} />
          <View style={[styles.puff, styles.puffC]} />
          <View style={[styles.puff, styles.puffD]} />
        </Animated.View>

        {/* The tub. */}
        <View
          style={[styles.bucket, { left: bucketX - bucketW / 2, top: BUCKET_Y, width: bucketW }]}
          pointerEvents="none"
        >
          {/* The opening: a ring with a dark interior, so a catch vanishes. */}
          <View style={[styles.mouth, { width: bucketW }]} />

          <View style={[styles.body, { width: bucketW - 8, height: bucketH }]}>
            <View style={styles.stripes}>
              <View style={[styles.stripe, styles.stripeRed]} />
              <View style={[styles.stripe, styles.stripeCream]} />
              <View style={[styles.stripe, styles.stripeRed]} />
              <View style={[styles.stripe, styles.stripeCream]} />
              <View style={[styles.stripe, styles.stripeRed]} />
            </View>
            {/* Edge shading, which is what makes a flat box read as a tub. */}
            <LinearGradient
              colors={[
                'rgba(69,10,10,0.30)',
                'rgba(69,10,10,0.04)',
                'rgba(255,255,255,0.22)',
                'rgba(69,10,10,0.04)',
                'rgba(69,10,10,0.30)',
              ]}
              locations={[0, 0.22, 0.5, 0.78, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </View>
          <View style={[styles.base, { width: bucketW - 26 }]} />

          {/* The mound, drawn last so it sits over the back of the rim. */}
          <View style={[styles.heap, { height: HEAP_RISE + 14, top: -HEAP_RISE }]}>
            {heapPieces.map((piece, i) => (
              <View
                key={i}
                style={[
                  styles.popped,
                  piece.butter ? styles.poppedButter : null,
                  {
                    width: piece.r * 2,
                    height: piece.r * 2,
                    borderRadius: piece.r * 0.74,
                    left: bucketW / 2 + piece.x * (bucketW / 2) * 0.86 - piece.r,
                    top: HEAP_RISE * piece.y - piece.r + 10,
                    transform: [{ rotate: `${piece.rot}deg` }],
                  },
                ]}
              />
            ))}
          </View>
        </View>

        {/* The aim guide, over everything — it is an instrument, not scenery. */}
        {dots.map((dot, i) => (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={[
              styles.aimDot,
              {
                opacity: Animated.multiply(aimOpacity, 1 - i * 0.085),
                transform: [
                  { translateX: Animated.subtract(dot.x, 3) },
                  { translateY: Animated.subtract(dot.y, 3) },
                ],
              },
            ]}
          />
        ))}

        {/* Wind, shown as the direction to lead into. */}
        <View style={styles.windRow} pointerEvents="none">
          <Text style={styles.windText}>
            {wind < 0 ? '←' : '→'} {'·'.repeat(windLabel)}
          </Text>
        </View>

        {message ? (
          <Text style={styles.message}>{message}</Text>
        ) : null}
      </View>

      <Text style={styles.hint}>
        {flying ? ' ' : 'Swipe up to throw — the dots show the arc'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 6 },
  score: { fontSize: 30, fontFamily: 'Inter_700Bold', color: '#111827' },
  best: { fontSize: 12, fontFamily: 'Inter_500Medium', color: '#9CA3AF' },

  play: {
    width: PLAY_W,
    height: PLAY_H,
    borderRadius: 14,
    backgroundColor: '#FFF8E7',
    overflow: 'hidden',
  },

  floor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 34,
    borderTopWidth: 1,
    borderTopColor: '#DCC08C',
    overflow: 'hidden',
  },
  launchPad: {
    position: 'absolute',
    left: LAUNCH_X - 26,
    top: LAUNCH_Y + 10,
    width: 52,
    height: 9,
    borderRadius: 5,
    backgroundColor: 'rgba(120,80,20,0.12)',
  },

  bucket: { position: 'absolute', alignItems: 'center' },
  mouth: {
    height: 17,
    borderRadius: 9,
    backgroundColor: '#5B1414',
    borderWidth: 3.5,
    borderColor: '#C9302A',
  },
  body: {
    marginTop: -4,
    flexDirection: 'row',
    overflow: 'hidden',
    borderBottomLeftRadius: 13,
    borderBottomRightRadius: 13,
    backgroundColor: '#FFF3DD',
  },
  stripes: { flexDirection: 'row', flex: 1 },
  stripe: { flex: 1 },
  stripeRed: { backgroundColor: '#D7352C' },
  stripeCream: { backgroundColor: '#FFF3DD' },
  base: {
    height: 6,
    marginTop: -2,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: '#A32520',
  },

  heap: { position: 'absolute', left: 0, right: 0 },
  popped: {
    position: 'absolute',
    backgroundColor: '#FFF8E4',
    borderWidth: 1.5,
    borderColor: '#EFD9A6',
  },
  poppedButter: { backgroundColor: '#FFEBBE', borderColor: '#E8C478' },

  kernel: { position: 'absolute', width: KERNEL, height: KERNEL },
  puff: {
    position: 'absolute',
    backgroundColor: '#FFF8E4',
    borderWidth: 1.5,
    borderColor: '#EDD49C',
  },
  puffA: { left: 0, top: 3, width: 12, height: 12, borderRadius: 5 },
  puffB: { left: 7, top: 0, width: 13, height: 13, borderRadius: 5 },
  puffC: { left: 2, top: 8, width: 11, height: 11, borderRadius: 4 },
  puffD: { left: 9, top: 8, width: 11, height: 11, borderRadius: 4 },

  aimDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#C2410C',
  },

  windRow: { position: 'absolute', left: 0, right: 0, bottom: 42, alignItems: 'center' },
  windText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#B08968', letterSpacing: 2 },

  message: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 96,
    textAlign: 'center',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#6B7280',
  },

  hint: {
    marginTop: 8,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
    height: 16,
  },
});
