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

const FIREWORK_COLORS = ['#0066FF', '#FF8C00', '#16A34A', '#EF4444', '#A855F7', '#F59E0B'];
const PARTICLES_PER_BURST = 14;

interface Burst {
  id: number;
  x: number;
  y: number;
  color: string;
}

function FireworkBurst({ x, y, color }: { x: number; y: number; color: string }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 900,
      useNativeDriver: true,
    }).start();
  }, [progress]);

  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLES_PER_BURST }, (_, i) => {
        const angle = (i / PARTICLES_PER_BURST) * Math.PI * 2;
        const distance = 46 + Math.random() * 28;
        return {
          dx: Math.cos(angle) * distance,
          dy: Math.sin(angle) * distance,
        };
      }),
    []
  );

  return (
    <View style={[styles.burstOrigin, { left: x, top: y }]} pointerEvents="none">
      {particles.map((p, i) => {
        const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] });
        const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, p.dy] });
        const opacity = progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] });
        const scale = progress.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.3, 1, 0.4] });
        return (
          <Animated.View
            key={i}
            style={[
              styles.particle,
              {
                backgroundColor: color,
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
    const spawn = () => {
      const id = nextId.current++;
      const burst: Burst = {
        id,
        x: 30 + Math.random() * (SCREEN_W - 60),
        y: 40 + Math.random() * 160,
        color: FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)],
      };
      setBursts((prev) => [...prev, burst]);
      setTimeout(() => {
        setBursts((prev) => prev.filter((b) => b.id !== id));
      }, 950);
    };

    spawn();
    const t1 = setTimeout(spawn, 260);
    const t2 = setTimeout(spawn, 520);
    const interval = setInterval(spawn, 1100);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearInterval(interval);
    };
  }, []);

  return (
    <View style={styles.fireworksLayer} pointerEvents="none">
      {bursts.map((b) => (
        <FireworkBurst key={b.id} x={b.x} y={b.y} color={b.color} />
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
          <Text style={styles.ctaText}>Get Started</Text>
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
  particle: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderRadius: 3.5,
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
