import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import type { TmdbMovieCard } from '@workspace/api-client-react';

interface DiscoverCardProps {
  movie: TmdbMovieCard;
  onPress: (movie: TmdbMovieCard) => void;
  width: number;
  height: number;
}

export function DiscoverCard({ movie, onPress, width, height }: DiscoverCardProps) {
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
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
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
    color: '#FFFFFF',
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 15,
  },
  year: {
    color: '#FF8C00',
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
});
