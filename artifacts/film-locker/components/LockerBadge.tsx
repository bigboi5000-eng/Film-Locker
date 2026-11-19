/**
 * The mark on a poster that says "this one is already yours".
 *
 * A tick for a film you have seen, a bookmark for one you have saved and
 * not yet watched. One component rather than a tick drawn in each card,
 * because the two states have to be told apart at a glance and the answer
 * must look the same on every screen that offers you a film.
 *
 * The tick existed already; the bookmark did not. So a film sitting in
 * your watchlist looked exactly like one you had never heard of, on the
 * trending rail, in a friend's playlist, on a director's page — every
 * place you are most likely to be offered something you have already
 * decided to watch.
 *
 * Positioned absolutely at the poster's top-right, so a card only has to
 * render it inside a relatively-positioned container and pass a status.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { LockerStatus } from '@/hooks/useLockerTitles';
import type { Palette } from '@/constants/colors';

export function LockerBadge({
  status,
  size = 22,
}: {
  status: LockerStatus;
  /** Matches the tick the cards drew before this existed. */
  size?: number;
}) {
  const styles = useThemedStyles(makeStyles);
  const colors = useColors();
  if (!status) return null;

  const box = { width: size, height: size, borderRadius: size / 2 };

  if (status === 'watched') {
    return (
      <View style={[styles.badge, styles.watched, box]}>
        <Text style={[styles.tick, { fontSize: size * 0.55 }]}>✓</Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.badge, styles.saved, box]}
      accessibilityLabel="Already in your watchlist"
    >
      <Ionicons name="bookmark" size={size * 0.5} color={colors.onColor} />
    </View>
  );
}

/**
 * The mark that says "this is a series, not a film".
 *
 * Drawn for television only, and never for a film. A badge on everything
 * is a badge on nothing, and the app is a film locker — a film is the
 * unmarked case, so the mark is the exception rather than a label on
 * every poster in the grid.
 *
 * Bottom-LEFT, deliberately: LockerBadge owns the top-right, and a series
 * you have already watched has to show both at once. Overlapping them
 * would hide whichever drew first, which is the kind of thing that only
 * shows up once somebody has a watched series.
 */
export function MediaKindBadge({ mediaType }: { mediaType?: string | null }) {
  const styles = useThemedStyles(makeStyles);
  if (mediaType !== 'tv') return null;
  return (
    <View style={styles.kind} accessibilityLabel="Television series">
      <Text style={styles.kindText}>TV</Text>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The colours the tick already used, kept so a watched film does not
  // change appearance just because the badge moved into its own file.
  watched: { backgroundColor: c.primary },
  /**
   * Deliberately not the primary blue.
   *
   * Saved and watched are different answers and the whole point is telling
   * them apart from across a poster grid, which two blue circles with
   * different glyphs do not do. The star colour is already the app's
   * second accent and reads at 22px against artwork.
   */
  saved: { backgroundColor: c.star },
  tick: { color: c.onColor, fontFamily: 'Inter_700Bold' },
  kind: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    // Dark and translucent rather than an accent colour: this is a label,
    // not a status, and it must not compete with the two badges above it
    // that say something the viewer can act on.
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  kindText: {
    color: '#fff',
    fontSize: 9,
    letterSpacing: 0.5,
    fontFamily: 'Inter_700Bold',
  },
});
