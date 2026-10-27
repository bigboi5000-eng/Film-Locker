import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import type { TmdbMovieCard } from '@workspace/api-client-react';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { Palette } from '@/constants/colors';

interface DiscoverCardProps {
  movie: TmdbMovieCard;
  onPress: (movie: TmdbMovieCard) => void;
  width: number;
  height: number;
  /**
   * Shows the same tick MovieCard uses, because a film you have seen is
   * worth marking most where you are being offered it again — a trending
   * rail, a recommendation, someone else's playlist.
   */
  isWatched?: boolean;
}

export function DiscoverCard({ movie, onPress, width, height, isWatched }: DiscoverCardProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      style={[styles.card, { width, height }]}
      onPress={() => onPress(movie)}
      activeOpacity={0.85}
    >
      <Image
        source={{ uri: movie.posterUrl }}
        style={styles.poster}
        contentFit="cover"
        transition={250}
        placeholder={require('@/assets/images/icon.png')}
      />
      <View style={styles.overlay}>
        <View style={styles.metaContainer}>
          <Text style={styles.title} numberOfLines={2}>{movie.title}</Text>
          {movie.releaseYear ? (
            <Text style={styles.year}>{movie.releaseYear}</Text>
          ) : null}
        </View>
      </View>
      {isWatched && (
        <View style={styles.watchedBadge}>
          <Text style={styles.watchedBadgeText}>✓</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  // Deliberately identical to MovieCard's, so one film does not wear two
  // different ticks depending on which screen it turns up on.
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
  card: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: c.surfaceAlt,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  poster: { width: '100%', height: '100%' },
  // Positioning only — no background here, so the dark scrim below sits
  // just behind the title/year text instead of tinting the whole poster.
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  metaContainer: {
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  title: {
    color: c.onColor,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 15,
  },
  year: {
    color: c.star,
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
});
