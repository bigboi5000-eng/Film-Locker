/**
 * PopcornToss — something to do while a film is being identified.
 *
 * Flick a kernel into the bucket. A fan blows across the play area and gets
 * stronger the better you do, so the arc has to be led into the wind.
 *
 * The rule that shapes everything here: identification finishing does NOT
 * interrupt a throw. If a kernel is in the air when the result lands, it
 * flies out and the screen changes when it comes down — being yanked out
 * mid-throw is worse than never having had the game. If nothing is in the
 * air, there is nothing to wait for and it leaves at once.
 *
 * Deliberately built from plain views and React Native's own Animated: no
 * new dependency, no image assets, and the kernel and bucket are shapes
 * rather than sprites. The whole thing is a few kilobytes of JavaScript and
 * changes the native binary not at all.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

const HIGH_SCORE_KEY = 'popcorn-toss-high-score';

// A fixed play area, centred. Fixing it avoids measuring layout and keeps
// the physics in one coordinate space that behaves the same on every phone.
const PLAY_W = 300;
const PLAY_H = 360;

const KERNEL = 18;
const LAUNCH_X = PLAY_W / 2;
const LAUNCH_Y = PLAY_H - 48;

const BUCKET_W = 120;
const BUCKET_H = 68;
const BUCKET_Y = 120; // top of the bucket's mouth
const MOUTH_INSET = 8; // the rim is thick; the opening is narrower than the box

/**
 * These are simulated, not guessed.
 *
 * The first pass used a 92px bucket at y=86 with gravity 1100 and allowed a
 * flick up to 1700px/s. Sweeping it showed why that would have been
 * miserable: a full-strength throw rose five times higher than it needed to,
 * spent nearly three seconds in the air and drifted hundreds of pixels on
 * the wind, so under 2% of throws scored and the margin for error on the
 * upward flick was almost nil — there was one arc that worked and everything
 * else sailed over.
 *
 * Widening the mouth, dropping the bucket and raising gravity gives roughly
 * 200px/s of sideways tolerance and 250-300px/s of vertical, holding up at
 * full wind and with the bucket off to one side, on a 0.5s flight. Forgiving
 * enough to learn, tight enough to miss.
 */
const GRAVITY = 1800; // px/s²
const MAX_UP = 1150; // hardest useful upward flick
const MIN_UP = 350; // below this it is a fumble, not a throw
const MAX_SIDE = 450;
const MAX_FLIGHT_MS = 4000; // a throw that goes nowhere still has to end

/** Wind grows with the score, so it stays winnable while getting harder. */
function windForScore(score: number): number {
  const strength = Math.min(60 + score * 55, 420);
  return Math.random() < 0.5 ? -strength : strength;
}

/** Where the bucket sits this round — never so near the edge it is unfair. */
function bucketXForScore(score: number): number {
  const margin = BUCKET_W / 2 + 14;
  const spread = Math.min(0.25 + score * 0.12, 1);
  const centre = PLAY_W / 2;
  const reach = (PLAY_W / 2 - margin) * spread;
  return centre + (Math.random() * 2 - 1) * reach;
}

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
  const [bucketX, setBucketX] = useState(() => bucketXForScore(0));
  const [flying, setFlying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Position is animated rather than held in state: a React render per frame
  // for sixty frames a second is how this would end up stuttering.
  const x = useRef(new Animated.Value(LAUNCH_X)).current;
  const y = useRef(new Animated.Value(LAUNCH_Y)).current;

  // Mirrors of state for the animation loop and the pan handler, which both
  // read them from closures created before the latest render.
  const flyingRef = useRef(false);
  const readyRef = useRef(ready);
  const windRef = useRef(wind);
  const bucketXRef = useRef(bucketX);
  const frameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => { readyRef.current = ready; }, [ready]);
  useEffect(() => { windRef.current = wind; }, [wind]);
  useEffect(() => { bucketXRef.current = bucketX; }, [bucketX]);

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

  /** Leave, but only when nothing is in the air. */
  const leaveIfSettled = useCallback(() => {
    if (!flyingRef.current) onDone();
  }, [onDone]);

  // The result can arrive while the player is simply looking at the screen,
  // in which case there is nothing to wait for.
  useEffect(() => {
    if (ready) leaveIfSettled();
  }, [ready, leaveIfSettled]);

  const resetKernel = useCallback(() => {
    x.setValue(LAUNCH_X);
    y.setValue(LAUNCH_Y);
  }, [x, y]);

  const land = useCallback(
    (hit: boolean) => {
      flyingRef.current = false;
      if (!mountedRef.current) return;
      setFlying(false);

      if (hit) {
        const next = score + 1;
        setScore(next);
        if (next > highScore) saveHighScore(next);
        setMessage('In!');
        setWind(windForScore(next));
        setBucketX(bucketXForScore(next));
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } else {
        setMessage('Missed');
        setWind(windForScore(score));
        setBucketX(bucketXForScore(score));
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      resetKernel();

      // The whole point of the game: the results wait for the kernel to come
      // down, not the other way round.
      if (readyRef.current) onDone();
    },
    [score, highScore, saveHighScore, resetKernel, onDone]
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
      let last = Date.now();
      const startedAt = last;

      const step = () => {
        if (!mountedRef.current) return;
        const now = Date.now();
        // Clamped: a backgrounded app returns with an enormous delta, which
        // would teleport the kernel straight through the bucket.
        const dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;

        const prevY = py;
        vx += windRef.current * dt;
        vy += GRAVITY * dt;
        px += vx * dt;
        py += vy * dt;

        x.setValue(px);
        y.setValue(py);

        // Falling across the mouth's plane, within its opening, is a goal.
        const mouthHalf = BUCKET_W / 2 - MOUTH_INSET;
        const crossedMouth = prevY <= BUCKET_Y && py > BUCKET_Y;
        if (vy > 0 && crossedMouth && Math.abs(px - bucketXRef.current) <= mouthHalf) {
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
    [x, y, land]
  );

  // PanResponder rather than a gesture library: this lives inside a modal,
  // it is one flick, and the built-in one needs no provider above it.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !flyingRef.current,
        onMoveShouldSetPanResponder: () => !flyingRef.current,
        onPanResponderRelease: (_evt, gesture) => {
          if (flyingRef.current) return;
          // Gesture velocity is px/ms. Upward only — a downward flick is a
          // fumble, not a throw.
          const vy = gesture.vy * 1000;
          if (vy > -MIN_UP) return;
          const vx = Math.max(Math.min(gesture.vx * 1000, MAX_SIDE), -MAX_SIDE);
          launch(vx, Math.max(vy, -MAX_UP));
        },
      }),
    [launch]
  );

  const windLabel = Math.abs(Math.round(wind / 55));

  return (
    <View style={styles.wrap}>
      <View style={styles.scoreRow}>
        <Text style={styles.score}>{score}</Text>
        <Text style={styles.best}>best {Math.max(highScore, score)}</Text>
      </View>

      <View style={styles.play} {...pan.panHandlers}>
        {/* Bucket — a tapered tub with stripes, drawn from plain views. */}
        <View
          style={[
            styles.bucket,
            { left: bucketX - BUCKET_W / 2, top: BUCKET_Y },
          ]}
        >
          <View style={styles.bucketRim} />
          <View style={styles.bucketBody}>
            <View style={styles.stripe} />
            <View style={styles.stripe} />
            <View style={styles.stripe} />
          </View>
        </View>

        {/* The kernel. */}
        <Animated.View
          style={[
            styles.kernel,
            { transform: [{ translateX: Animated.subtract(x, KERNEL / 2) }, { translateY: Animated.subtract(y, KERNEL / 2) }] },
          ]}
        />

        {/* Wind, shown as the direction to lead into. */}
        <View style={styles.windRow}>
          <Text style={styles.windText}>
            {wind < 0 ? '←' : '→'} {'·'.repeat(Math.max(windLabel, 1))}
          </Text>
        </View>

        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>

      <Text style={styles.hint}>
        {flying ? ' ' : 'Flick the kernel into the bucket'}
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

  bucket: { position: 'absolute', width: BUCKET_W, alignItems: 'center' },
  bucketRim: {
    width: BUCKET_W,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#B91C1C',
  },
  bucketBody: {
    width: BUCKET_W - 10,
    height: BUCKET_H,
    flexDirection: 'row',
    overflow: 'hidden',
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  stripe: { flex: 1, backgroundColor: '#DC2626', marginHorizontal: 6 },

  kernel: {
    position: 'absolute',
    width: KERNEL,
    height: KERNEL,
    borderRadius: KERNEL / 2,
    backgroundColor: '#FDE68A',
    borderWidth: 2,
    borderColor: '#F59E0B',
  },

  windRow: { position: 'absolute', left: 0, right: 0, bottom: 10, alignItems: 'center' },
  windText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#9CA3AF', letterSpacing: 2 },

  message: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: BUCKET_Y + BUCKET_H + 18,
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
