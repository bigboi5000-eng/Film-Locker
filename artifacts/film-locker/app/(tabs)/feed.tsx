/**
 * The feed, as its own tab.
 *
 * It lived inside Community alongside the messages and the people, which
 * put the one thing you open the app to browse two taps behind a tab named
 * after something else. Messages are a thing you go to when the badge says
 * so; the feed is a thing you go to when you have a minute.
 *
 * The view itself is unchanged — only where it hangs.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SignedOutGate } from '@/components/SignedOutGate';
import { SocialFeedView } from '@/components/SocialFeed';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { Palette } from '@/constants/colors';

function FeedScreenInner() {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Feed</Text>
      </View>
      <SocialFeedView />
    </View>
  );
}

export default function FeedScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <SignedOutGate
        icon="newspaper-outline"
        title="See what everyone is watching"
        blurb="Follow people and this fills with the films they watch, rate and review."
      />
    );
  }
  return <FeedScreenInner />;
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: c.text, letterSpacing: 0.5 },
});
