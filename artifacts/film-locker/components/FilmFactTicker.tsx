/**
 * FilmFactTicker — something to read while a film is being identified.
 *
 * Replaces the popcorn game that used to fill this wait. The game had a
 * problem no amount of tuning fixed: it had to hold the result back until a
 * throw finished, which meant the thing the user actually asked for waited
 * on the thing they did not. A fact needs no such bargain — the moment the
 * film is identified the screen can move on mid-sentence, and nothing is
 * lost.
 *
 * One fact at a time, cross-faded. Plain views and React Native's own
 * Animated: no dependency, no assets.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { shuffledFacts } from '@/constants/filmFacts';

/** How long a fact stays up. Long enough to read twice without hurrying. */
const DWELL_MS = 7000;
const FADE_MS = 320;

/**
 * The first fact waits this long before fading in.
 *
 * Most link shares resolve inside a second, and a sentence that appears and
 * vanishes before it can be read is worse than a plain spinner. The text is
 * mounted the whole time regardless, so the card reserves its height from
 * the start and nothing jumps when the fact does appear.
 */
const FIRST_FACT_DELAY_MS = 700;

export interface FilmFactTickerProps {
  /** Reserve the height of the tallest fact, so the card does not jump. */
  minHeight?: number;
  style?: StyleProp<ViewStyle>;
}

export function FilmFactTicker({ minHeight = 76, style }: FilmFactTickerProps) {
  // Shuffled once per mount, so a wait never repeats itself and two waits in
  // a row do not open with the same fact.
  const order = useRef<string[]>(shuffledFacts()).current;
  const [index, setIndex] = useState(0);
  const opacity = useRef(new Animated.Value(0)).current;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Fade in — held back on the very first one, instant on every swap after.
  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: FADE_MS,
      delay: index === 0 ? FIRST_FACT_DELAY_MS : 0,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity, index]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!mountedRef.current) return;
      // Fade out, swap, and let the effect above fade the next one in. The
      // swap happens in the completion callback so the two never overlap.
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_MS,
        useNativeDriver: true,
      }).start(() => {
        if (!mountedRef.current) return;
        setIndex((i) => (i + 1) % order.length);
      });
    }, index === 0 ? DWELL_MS + FIRST_FACT_DELAY_MS : DWELL_MS);
    return () => clearTimeout(timer);
  }, [index, opacity, order.length]);

  return (
    <View style={[styles.wrap, { minHeight }, style]}>
      <Text style={styles.label}>DID YOU KNOW</Text>
      <Animated.Text style={[styles.fact, { opacity }]}>{order[index]}</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 4 },
  label: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#C2410C',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  fact: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 19,
  },
});
