import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Alert,
  Platform,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import {
  useListMovies,
  useDeleteMovie,
  getListMoviesQueryKey,
  type Movie,
} from '@workspace/api-client-react';
import { MovieCard, MovieCardSkeleton } from '@/components/MovieCard';
import { FilmDetailModal } from '@/components/FilmDetailModal';
import { FilterBar, FilterState, applyFilters } from '@/components/FilterBar';
import { confirmDestructive } from '@/lib/confirm';

const HORIZONTAL_PADDING = 16;
const COLUMN_GAP = 10;

export default function WatchedScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<FilterState>({});
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);

  const { data: moviesData, isLoading, isRefetching, refetch } = useListMovies();
  const { mutateAsync: deleteMovie } = useDeleteMovie();

  const allMovies = moviesData?.movies ?? [];
  const watchedMovies = allMovies.filter((m) => m.isWatched);

  const filteredMovies = useMemo(
    () => applyFilters(watchedMovies, filters),
    [watchedMovies, filters]
  );

  const handleDelete = useCallback(
    (id: number) => {
      const title = allMovies.find((m) => m.id === id)?.title ?? 'this film';
      confirmDestructive(`Would you like to remove "${title}" from your Watched list?`, 'Remove', async () => {
        if (Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
        try {
          await deleteMovie({ id });
          await queryClient.invalidateQueries({ queryKey: getListMoviesQueryKey() });
        } catch {
          Alert.alert('Error', 'Could not remove the film.');
        }
      });
    },
    [deleteMovie, queryClient, allMovies]
  );

  const renderMovie = useCallback(
    ({ item }: { item: Movie }) => (
      <MovieCard
        id={item.id}
        title={item.title}
        releaseYear={item.releaseYear}
        posterUrl={item.posterUrl}
        rating={item.rating}
        isWatched
        onPress={() => setSelectedMovie(item)}
        onLongPress={handleDelete}
      />
    ),
    [handleDelete]
  );

  const ListHeader = (
    <View>
      {/* Screen header */}
      <View
        style={[
          styles.screenHeader,
          { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) },
        ]}
      >
        <Text style={styles.screenTitle}>Watched</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{watchedMovies.length}</Text>
        </View>
      </View>

      {/* Filter bar */}
      <FilterBar movies={watchedMovies} filters={filters} onChange={setFilters} />

      {/* Section label */}
      {filteredMovies.length > 0 && (
        <View style={styles.sectionLabelRow}>
          <Text style={styles.sectionLabel}>
            {filteredMovies.length} FILM{filteredMovies.length === 1 ? '' : 'S'}
          </Text>
          <Text style={styles.sectionHint}>Hold to remove</Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.root}>
      {isLoading ? (
        <>
          {ListHeader}
          <View style={styles.skeletonGrid}>
            {[...Array(6)].map((_, i) => (
              <MovieCardSkeleton key={i} />
            ))}
          </View>
        </>
      ) : (
        <FlatList<Movie>
          data={filteredMovies}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderMovie}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={[
            styles.contentContainer,
            { paddingBottom: insets.bottom + 16 },
          ]}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="checkmark-circle-outline" size={48} color="#D1D5DB" />
              <Text style={styles.emptyTitle}>
                {Object.keys(filters).length > 0 ? 'No films match your filters' : 'Nothing watched yet'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {Object.keys(filters).length > 0
                  ? 'Try clearing your filters'
                  : 'Tap a film in your Watchlist and mark it as Watched to see it here'}
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor="#0066FF"
              colors={['#0066FF']}
            />
          }
        />
      )}

      {selectedMovie && (
        <FilmDetailModal
          visible={selectedMovie !== null}
          onClose={() => setSelectedMovie(null)}
          tmdbId={selectedMovie.tmdbId}
          title={selectedMovie.title}
          posterUrl={selectedMovie.posterUrl}
          releaseYear={selectedMovie.releaseYear}
          overview={selectedMovie.overview}
          savedMovie={selectedMovie}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  contentContainer: { paddingHorizontal: HORIZONTAL_PADDING },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingBottom: 14,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  screenTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#111827',
    letterSpacing: 0.5,
  },
  countBadge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FF8C00',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  countText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 4,
    paddingBottom: 10,
  },
  sectionLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#9CA3AF',
    letterSpacing: 1.5,
  },
  sectionHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },
  columnWrapper: { gap: COLUMN_GAP, marginBottom: COLUMN_GAP },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: COLUMN_GAP,
  },
  emptyState: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32 },
  emptyTitle: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: '#374151',
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
});
