import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * What a tab shows when nobody is signed in.
 *
 * Browsing films needs no account, and App Store guideline 5.1.1(v) requires
 * that it does not have one — an app may not demand registration to reach
 * features that are not account based. But a watchlist, an inbox and a
 * profile are account based by definition: there is nothing to show someone
 * who has no account, so these tabs explain that and offer the way in.
 *
 * Deliberately not a redirect. Bouncing someone to a sign-in screen for
 * tapping a tab is the behaviour that got the app rejected; this leaves them
 * exactly where they are, free to go back to browsing.
 */
export function SignedOutGate({
  icon,
  title,
  blurb,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  blurb: string;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={30} color="#0066FF" />
      </View>

      <Text style={styles.title}>{title}</Text>
      <Text style={styles.blurb}>{blurb}</Text>

      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={() => router.push('/(auth)/sign-up')}
        activeOpacity={0.85}
      >
        <Text style={styles.primaryBtnText}>Create an account</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={() => router.push('/(auth)/sign-in')}
        activeOpacity={0.7}
      >
        <Text style={styles.secondaryBtnText}>I already have one</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#EFF6FF',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20, fontFamily: 'Inter_700Bold', color: '#111827',
    textAlign: 'center', marginBottom: 8,
  },
  blurb: {
    fontSize: 14, fontFamily: 'Inter_400Regular', color: '#6B7280',
    textAlign: 'center', lineHeight: 20, marginBottom: 28,
  },
  primaryBtn: {
    backgroundColor: '#0066FF', borderRadius: 12,
    paddingVertical: 15, paddingHorizontal: 40,
    alignSelf: 'stretch', alignItems: 'center',
  },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
  secondaryBtn: { paddingVertical: 16 },
  secondaryBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#0066FF' },
});
