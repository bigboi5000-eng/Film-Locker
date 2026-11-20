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
 * INLINE, sitting beside the year inside the card's own caption, rather
 * than floating over the artwork. It was absolutely positioned at the
 * poster's bottom-left to begin with, which put it straight on top of the
 * release year — the captions are bottom-aligned, so "TV" and "2026"
 * occupied the same pixels and the year was unreadable underneath it.
 *
 * Every corner of a poster is already spoken for: LockerBadge has the
 * top-right, the collaborator faces have the top-left, and the caption
 * owns the whole bottom edge. There was no free corner to move it to, and
 * a fifth thing floating over the artwork would be one too many anyway.
 * In the caption it is what it actually is — a piece of metadata, read
 * alongside the year rather than competing with it.
 */
export function MediaKindChip({ mediaType }: { mediaType?: string | null }) {
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
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    marginRight: 5,
    // A hairline outline rather than a filled block: it sits on a caption
    // that is already a dark scrim, so a dark fill would be invisible and
    // a bright one would shout louder than the title above it.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  kindText: {
    color: '#fff',
    fontSize: 8,
    letterSpacing: 0.5,
    lineHeight: 11,
    fontFamily: 'Inter_700Bold',
  },
});
