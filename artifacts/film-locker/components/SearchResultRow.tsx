import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { Movie, TmdbMovieCard } from '@workspace/api-client-react';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

const HORIZONTAL_PADDING = 16;

export interface SearchResultRowProps {
  movie: TmdbMovieCard;
  isSaved: boolean;
  savedMovie?: Movie;
  onPress: (movie: TmdbMovieCard, savedMovie?: Movie) => void;
  /** Ticked when the viewer has already seen this one. */
  isWatched?: boolean;
}

/**
 * One film in a list of search results.
 *
 * Lifted out of the Films tab so Home can use the same thing. Home drew
 * its own results as a poster grid, which reads as a browse rail rather
 * than an answer: a search is a question with an ordered list of
 * candidates, and a row gives each one a full-width title, its year and
 * room for the badges saying you already own or have seen it — none of
 * which fits under a poster. Two layouts for one operation also meant
 * searching felt like a different feature depending on which tab you
 * happened to be on.
 */
export function SearchResultRow({
  movie,
  isSaved,
  savedMovie,
  onPress,
  isWatched,
}: SearchResultRowProps) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      style={styles.resultRow}
      onPress={() => onPress(movie, savedMovie)}
      activeOpacity={0.75}
    >
      <Image
        source={{ uri: movie.posterUrl }}
        style={styles.resultPoster}
        contentFit="cover"
        transition={200}
        placeholder={require('@/assets/images/icon.png')}
      />
      <View style={styles.resultInfo}>
        <Text style={styles.resultTitle} numberOfLines={2}>
          {movie.title}
        </Text>
        {movie.releaseYear ? <Text style={styles.resultYear}>{movie.releaseYear}</Text> : null}
      </View>
      {isWatched && (
        <View style={[styles.badge, styles.watchedBadge]}>
          <Ionicons name="checkmark" size={15} color={colors.onColor} />
        </View>
      )}
      {isSaved && (
        <View style={styles.badge}>
          <Ionicons name="bookmark" size={14} color={colors.onColor} />
        </View>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.surfaceAlt,
  },
  resultPoster: {
    width: 42,
    height: 63,
    borderRadius: 6,
    backgroundColor: c.surfaceAlt,
    marginRight: 12,
  },
  resultInfo: { flex: 1 },
  resultTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: c.text,
    lineHeight: 19,
  },
  resultYear: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: c.star,
    marginTop: 3,
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  watchedBadge: { backgroundColor: c.successStrong },
});
