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
import { useColors } from '@/hooks/useColors';

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
  onLongPress?: (id: number) => void;
}

export function MovieCard({ id, title, releaseYear, posterUrl, onLongPress }: MovieCardProps) {
  const colors = useColors();

  const handleLongPress = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    onLongPress?.(id);
  }, [id, onLongPress]);

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderRadius: colors.radius }]}
      onLongPress={handleLongPress}
      delayLongPress={400}
      activeOpacity={0.85}
    >
      <Image
        source={{ uri: posterUrl }}
        style={[styles.poster, { borderRadius: colors.radius }]}
        contentFit="cover"
        transition={300}
        placeholder={require('@/assets/images/icon.png')}
      />
      {/* Gradient overlay */}
      <View style={[styles.overlay, { borderRadius: colors.radius }]}>
        <View style={styles.metaContainer}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {releaseYear ? (
            <Text style={styles.year}>{releaseYear}</Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export function MovieCardSkeleton() {
  const colors = useColors();
  return (
    <View
      style={[
        styles.card,
        styles.skeleton,
        { backgroundColor: colors.card, borderRadius: colors.radius },
      ]}
    >
      <ActivityIndicator color={colors.mutedForeground} size="small" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    overflow: 'hidden',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  metaContainer: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 16,
  },
  year: {
    color: '#C8A84B',
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  skeleton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
