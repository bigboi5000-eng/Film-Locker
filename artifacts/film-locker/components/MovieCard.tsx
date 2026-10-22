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
  skeleton: { alignItems: 'center', justifyContent: 'center' },
});
