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

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COLUMN_GAP = 10;
const HORIZONTAL_PADDING = 16;
const CARD_WIDTH = (SCREEN_WIDTH - HORIZONTAL_PADDING * 2 - COLUMN_GAP) / 2;
const CARD_HEIGHT = CARD_WIDTH * 1.5; // 2:3 poster ratio

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
  return (
    <View style={[styles.card, styles.skeleton]}>
      <ActivityIndicator color="#D1D5DB" size="small" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
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
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 16,
  },
  year: {
    color: '#FF8C00',
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  stars: {
    color: '#FF8C00',
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
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchedBadgeText: { color: '#FFFFFF', fontSize: 12, fontFamily: 'Inter_700Bold' },
  skeleton: { alignItems: 'center', justifyContent: 'center' },
});
