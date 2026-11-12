import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COLUMN_GAP = 10;
const HORIZONTAL_PADDING = 16;
/**
 * Three across, in both grids that use this card.
 *
 * A poster is recognisable long before it is legible, so the second column
 * was spending width on a size nobody needed to identify a film they own.
 * Three fits half again as many on screen and still leaves each poster
 * wider than a thumbnail.
 *
 * Defined here rather than passed in because the card is only ever used in
 * those two grids — a number in two places that must agree is a number that
 * eventually will not.
 */
const COLUMNS = 3;
const CARD_WIDTH =
  (SCREEN_WIDTH - HORIZONTAL_PADDING * 2 - COLUMN_GAP * (COLUMNS - 1)) / COLUMNS;
const CARD_HEIGHT = CARD_WIDTH * 1.5; // 2:3 poster ratio
const CARD_RADIUS = 10;

/**
 * The grid's geometry, exported for anything that has to draw in register
 * with the cards rather than beside them.
 *
 * Re-deriving these numbers somewhere else is how an overlay ends up a
 * couple of pixels out of line on one screen width and nobody notices
 * until it is on a phone.
 */
export const GRID_COLUMNS = COLUMNS;
export const GRID_COLUMN_GAP = COLUMN_GAP;
export const GRID_HORIZONTAL_PADDING = HORIZONTAL_PADDING;
export const GRID_CARD_WIDTH = CARD_WIDTH;
export const GRID_CARD_RADIUS = CARD_RADIUS;

/**
 * A small coloured circle drawn on the poster, one per person.
 *
 * Used on a shared playlist to show which of the people on it have seen
 * this film. The card knows nothing about collaborators — it draws what it
 * is handed, in the order it is handed them.
 */
export interface MovieCardBadge {
  key: string;
  /** One or two letters. Longer is unreadable at this size. */
  label: string;
  color: string;
}

export interface MovieCardProps {
  id: number;
  title: string;
  releaseYear: string;
  posterUrl: string;
  onPress?: (id: number) => void;
  onLongPress?: (id: number) => void;
  /** Show a watched checkmark badge */
  isWatched?: boolean;
  /** Star rating 1–5 */
  rating?: number | null;
  /**
   * People to mark on this poster, drawn top-left in the order given.
   *
   * Top-left because the watched tick is top-right, and a row that grew
   * leftwards from there would collide with it on the third person.
   */
  badges?: MovieCardBadge[];
}

export function MovieCard({
  id,
  title,
  releaseYear,
  posterUrl,
  onPress,
  onLongPress,
  isWatched,
  rating,
  badges,
}: MovieCardProps) {
  const styles = useThemedStyles(makeStyles);
  const handlePress = useCallback(() => onPress?.(id), [id, onPress]);
  const handleLongPress = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onLongPress?.(id);
  }, [id, onLongPress]);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={400}
      activeOpacity={0.88}
    >
      <Image
        source={{ uri: posterUrl }}
        style={styles.poster}
        contentFit="cover"
        transition={300}
        placeholder={require('@/assets/images/icon.png')}
      />

      {/* Gradient-like overlay at bottom */}
      <View style={styles.overlay}>
        <View style={styles.metaContainer}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {releaseYear ? <Text style={styles.year}>{releaseYear}</Text> : null}
          {typeof rating === 'number' && rating > 0 && (
            <Text style={styles.stars}>{'★'.repeat(rating)}</Text>
          )}
        </View>
      </View>

      {/* Watched badge */}
      {isWatched && (
        <View style={styles.watchedBadge}>
          <Text style={styles.watchedBadgeText}>✓</Text>
        </View>
      )}

      {/* Who else has seen it. Capped at four with a +n, because five
          circles across a poster this wide covers the artwork and the
          fifth is unreadable anyway. */}
      {badges && badges.length > 0 && (
        <View style={styles.badgeRow}>
          {badges.slice(0, 4).map((b) => (
            <View key={b.key} style={[styles.personBadge, { backgroundColor: b.color }]}>
              <Text style={styles.personBadgeText} numberOfLines={1}>{b.label}</Text>
            </View>
          ))}
          {badges.length > 4 && (
            <View style={[styles.personBadge, styles.personBadgeOverflow]}>
              <Text style={styles.personBadgeText} numberOfLines={1}>+{badges.length - 4}</Text>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

export function MovieCardSkeleton() {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.card, styles.skeleton]}>
      <ActivityIndicator color={colors.iconFaint} size="small" />
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    backgroundColor: c.surfaceAlt,
    // Light shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  poster: { width: '100%', height: '100%' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  metaContainer: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.68)',
  },
  title: {
    color: c.onColor,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 16,
  },
  year: {
    color: c.star,
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  stars: {
    color: c.star,
    fontSize: 11,
    marginTop: 2,
  },
  watchedBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchedBadgeText: { color: c.onColor, fontSize: 12, fontFamily: 'Inter_700Bold' },
  badgeRow: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    // Overlapped rather than spaced, the way a group of faces is shown
    // elsewhere: four circles at full width would reach the watched tick.
    alignItems: 'center',
  },
  personBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -5,
    // A ring in the card's own colour, so adjacent badges stay separate
    // circles instead of reading as one blob where they overlap.
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.35)',
  },
  personBadgeOverflow: { backgroundColor: 'rgba(0,0,0,0.72)' },
  personBadgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    lineHeight: 10,
    fontFamily: 'Inter_700Bold',
  },
  skeleton: { alignItems: 'center', justifyContent: 'center' },
});
