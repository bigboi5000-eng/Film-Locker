import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

const WELCOME_SEEN_KEY = 'film-locker:hasSeenWelcome';
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ── Fireworks ────────────────────────────────────────────────────────────────

const FIREWORK_COLORS = [
  '#0066FF', '#FF8C00', '#16A34A', '#EF4444', '#A855F7',
  '#F59E0B', '#EC4899', '#22D3EE', '#FACC15', '#F97316',
];

/** Longest a burst can live, so the cleanup timer never cuts one short. */
const MAX_BURST_MS = 1500;

/** How long the opening finale runs before the display settles down. */
const FINALE_MS = 4000;
/** Salvo spacing during the finale, and after it settles. */
const FINALE_SALVO_MS = 480;
const CALM_SALVO_MS = 2600;

interface Burst {
  id: number;
  x: number;
  y: number;
  /** Two colours per burst — real shells rarely fire a single flat colour. */
  colors: [string, string];
  particleCount: number;
  radius: number;
  duration: number;
  /** Adds an inner ring at a shorter radius, for a denser double-shell look. */
  hasInnerRing: boolean;
}

interface Particle {
  dx: number;
  dy: number;
  size: number;
  color: string;
  /** Fraction of the burst's life this particle survives — uneven, so the
   *  shell frays as it dies instead of vanishing all at once. */
  life: number;
}

function pickColor(): string {
  return FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
}

function FireworkBurst({ burst }: { burst: Burst }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: burst.duration,
      useNativeDriver: true,
    }).start();
  }, [progress, burst.duration]);

  const particles = useMemo<Particle[]>(() => {
    const { particleCount, radius, colors, hasInnerRing } = burst;

    const ring = (count: number, ringRadius: number, offset: number): Particle[] =>
      Array.from({ length: count }, (_, i) => {
        // Jitter the angle so the ring doesn't look mechanically even.
        const angle = ((i + offset) / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
        const distance = ringRadius * (0.75 + Math.random() * 0.45);
        return {
          dx: Math.cos(angle) * distance,
          dy: Math.sin(angle) * distance,
          size: 4 + Math.random() * 5,
          color: Math.random() < 0.5 ? colors[0] : colors[1],
          life: 0.72 + Math.random() * 0.28,
        };
      });

    return hasInnerRing
      ? [...ring(particleCount, radius, 0), ...ring(Math.round(particleCount * 0.55), radius * 0.5, 0.5)]
      : ring(particleCount, radius, 0);
  }, [burst]);

  // The initial flash — a bright core that blows out and vanishes fast, which
  // is what sells the moment of detonation.
  const flashScale = progress.interpolate({
    inputRange: [0, 0.12, 0.3],
    outputRange: [0.2, 2.6, 3.4],
    extrapolate: 'clamp',
  });
  const flashOpacity = progress.interpolate({
    inputRange: [0, 0.05, 0.28],
    outputRange: [0.95, 0.7, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.burstOrigin, { left: burst.x, top: burst.y }]} pointerEvents="none">
      <Animated.View
        style={[
          styles.flash,
          { backgroundColor: burst.colors[0], opacity: flashOpacity, transform: [{ scale: flashScale }] },
        ]}
      />

      {particles.map((p, i) => {
        const translateX = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, p.dx],
        });

        // Out fast, then sag under gravity — the arc is what separates a
        // firework from a starburst.
        const translateY = progress.interpolate({
          inputRange: [0, 0.45, 1],
          outputRange: [0, p.dy * 0.82, p.dy + p.dy * 0.12 + 46],
        });

        const opacity = progress.interpolate({
          inputRange: [0, 0.06, p.life * 0.7, p.life],
          outputRange: [0, 1, 0.85, 0],
          extrapolate: 'clamp',
        });

        // Flares on detonation, then shrinks to an ember.
        const scale = progress.interpolate({
          inputRange: [0, 0.14, 0.6, 1],
          outputRange: [0.35, 1.15, 0.75, 0.3],
        });

        return (
          <Animated.View
            key={i}
            style={[
              styles.particle,
              {
                width: p.size,
                height: p.size,
                borderRadius: p.size / 2,
                backgroundColor: p.color,
                opacity,
                transform: [{ translateX }, { translateY }, { scale }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function Fireworks() {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();

    // The finale burns itself out after FINALE_MS and the display drops to a
    // slow drift of small shells. Read as a phase rather than a stop: an
    // empty sky would leave the screen looking broken to anyone still
    // reading the feature list, and the loud version does not want watching
    // for a whole minute.
    let calm = false;

    const spawnOne = () => {
      const id = nextId.current++;
      // Big shells belong to the finale only.
      const big = !calm && Math.random() < 0.35;

      const burst: Burst = {
        id,
        x: 20 + Math.random() * (SCREEN_W - 40),
        // Across most of the screen rather than a band at the top, so the
        // whole thing feels surrounded rather than decorated.
        y: 50 + Math.random() * (SCREEN_H * 0.62),
        colors: [pickColor(), pickColor()],
        particleCount: big ? 26 : calm ? 11 + Math.floor(Math.random() * 5) : 16 + Math.floor(Math.random() * 6),
        radius: big ? 95 + Math.random() * 45 : calm ? 42 + Math.random() * 26 : 55 + Math.random() * 35,
        duration: big ? 1150 + Math.random() * 300 : 850 + Math.random() * 250,
        hasInnerRing: big || (!calm && Math.random() < 0.3),
      };

      setBursts((prev) => [...prev, burst]);

      const cleanup = setTimeout(() => {
        setBursts((prev) => prev.filter((b) => b.id !== id));
        timers.delete(cleanup);
      }, MAX_BURST_MS);
      timers.add(cleanup);
    };

    // Salvos rather than a metronome: during the finale most ticks fire one
    // shell and some fire two or three in quick succession, which reads as
    // chaotic rather than scheduled. Once calm, always a single shell.
    const salvo = () => {
      spawnOne();
      if (calm) return;

      const extra = Math.random() < 0.45 ? 1 + Math.floor(Math.random() * 2) : 0;
      for (let i = 0; i < extra; i++) {
        const t = setTimeout(() => {
          spawnOne();
          timers.delete(t);
        }, 90 + Math.random() * 220);
        timers.add(t);
      }
    };

    // Open with a flurry so the screen is already alive on arrival.
    salvo();
    [140, 300, 460, 620].forEach((delay) => {
      const t = setTimeout(() => {
        salvo();
        timers.delete(t);
      }, delay);
      timers.add(t);
    });

    // ~3.5 shells a second, which keeps roughly 140 particles alive at once
    // against about 14 before. All of it is transform/opacity on the native
    // driver, so the JS thread stays free — but it is still 140 views to
    // composite, and this is the first screen anyone sees, so the rate is
    // kept just off the maximum. Lower this number for more chaos.
    let interval = setInterval(salvo, FINALE_SALVO_MS);

    const settle = setTimeout(() => {
      calm = true;
      clearInterval(interval);
      interval = setInterval(salvo, CALM_SALVO_MS);
      timers.delete(settle);
    }, FINALE_MS);
    timers.add(settle);

    return () => {
      // `interval` is reassigned when the display settles, and this closes
      // over the binding rather than the value, so it clears whichever one
      // is currently running.
      clearInterval(interval);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <View style={styles.fireworksLayer} pointerEvents="none">
      {bursts.map((b) => (
        <FireworkBurst key={b.id} burst={b} />
      ))}
    </View>
  );
}

// ── Feature highlights ───────────────────────────────────────────────────────

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; title: string; blurb: string }[] = [
  {
    icon: 'share-social',
    title: 'Share From Socials',
    blurb: "Share a post from Instagram — we'll find the film.",
  },
  {
    icon: 'sparkles',
    title: 'AI Recommendations',
    blurb: 'Ask for movie ideas — Gemini finds your perfect match.',
  },
  {
    icon: 'people',
    title: 'Share With Friends',
    blurb: 'Recommend films to friends, right inside the app.',
  },
  {
    icon: 'star',
    title: 'Comment & Rate',
    blurb: 'Rate films and discuss them with the community.',
  },
];

function FeatureRow({ icon, title, blurb, index }: { icon: keyof typeof Ionicons.glyphMap; title: string; blurb: string; index: number }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 420,
      delay: 500 + index * 120,
      useNativeDriver: true,
    }).start();
  }, [anim, index]);

  return (
    <Animated.View
      style={[
        styles.featureRow,
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        },
      ]}
    >
      <View style={styles.featureIcon}>
        <Ionicons name={icon} size={20} color="#0066FF" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureBlurb}>{blurb}</Text>
      </View>
    </Animated.View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);

  // Returning users (already onboarded) skip straight to sign-in.
  useEffect(() => {
    AsyncStorage.getItem(WELCOME_SEEN_KEY).then((seen) => {
      if (seen === 'true') {
        router.replace('/(auth)/sign-in');
      } else {
        setReady(true);
      }
    });
  }, [router]);

  const handleGetStarted = async () => {
    await AsyncStorage.setItem(WELCOME_SEEN_KEY, 'true');
    router.replace('/(auth)/sign-in');
  };

  if (!ready) return null;

  return (
    <LinearGradient colors={['#0B1220', '#111C33', '#0B1220']} style={styles.root}>
      <Fireworks />

      <View style={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.hero}>
          <Text style={styles.emoji}>🎬</Text>
          <Text style={styles.title}>Welcome to Film Locker</Text>
          <Text style={styles.subtitle}>Your films, your friends, all in one place.</Text>
        </View>

        <View style={styles.featureList}>
          {FEATURES.map((f, i) => (
            <FeatureRow key={f.title} icon={f.icon} title={f.title} blurb={f.blurb} index={i} />
          ))}
        </View>

        <TouchableOpacity style={styles.cta} onPress={handleGetStarted} activeOpacity={0.85}>
          <Text style={styles.ctaText}>Aim for the bushes!</Text>
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" style={{ marginLeft: 8 }} />
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fireworksLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  burstOrigin: {
    position: 'absolute',
    width: 0,
    height: 0,
  },
  // Size, radius and colour are all per-particle now, set inline.
  particle: {
    position: 'absolute',
  },
  flash: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    marginLeft: -8,
    marginTop: -8,
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
  },
  hero: {
    alignItems: 'center',
    marginTop: SCREEN_H * 0.06,
  },
  emoji: { fontSize: 56, marginBottom: 12 },
  title: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#9CA9C7',
    textAlign: 'center',
    marginTop: 8,
  },
  featureList: {
    gap: 18,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(0,102,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  featureBlurb: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#9CA9C7',
    lineHeight: 18,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0066FF',
    height: 54,
    borderRadius: 14,
    marginTop: 24,
  },
  ctaText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
});
