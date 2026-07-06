import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import {
  useListMovies,
  useDeleteMovie,
  useProcessSocialLink,
  getListMoviesQueryKey,
  type Movie,
} from '@workspace/api-client-react';
import { MovieCard, MovieCardSkeleton } from '@/components/MovieCard';
import { FilmDetailModal } from '@/components/FilmDetailModal';
import { FilterBar, FilterState, applyFilters } from '@/components/FilterBar';

const HORIZONTAL_PADDING = 16;
const COLUMN_GAP = 10;

export default function WatchlistScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [filters, setFilters] = useState<FilterState>({});
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);

  const { data: moviesData, isLoading, isRefetching, refetch } = useListMovies();
  const { mutateAsync: deleteMovie } = useDeleteMovie();
  const { mutateAsync: processLink, isPending: isProcessing } = useProcessSocialLink();

  const allMovies = moviesData?.movies ?? [];
  const watchlistMovies = allMovies.filter((m) => !m.isWatched);

  const filteredMovies = useMemo(() => {
    let result = applyFilters(watchlistMovies, filters);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((m) => m.title.toLowerCase().includes(q));
    }
    return result;
  }, [watchlistMovies, filters, searchQuery]);

  const handleProcessLink = useCallback(async () => {
    const trimmed = linkUrl.trim();
    if (!trimmed) return;

    try {
      const result = await processLink({ data: { url: trimmed } });
      setLinkUrl('');
      await queryClient.invalidateQueries({ queryKey: getListMoviesQueryKey() });

      const saved = result.saved ?? [];
      if (Platform.OS !== 'web' && saved.length > 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      if (saved.length === 0) {
        Alert.alert(
          'No Films Found',
          result.source === 'none'
            ? 'Could not extract any movie titles from this link.'
            : `Processed via ${result.source} — no recognizable film titles found.`
        );
      } else {
        Alert.alert(
          '🎬 Films Added',
          `${saved.length} film${saved.length === 1 ? '' : 's'} added to your Watchlist:\n${saved.map((m) => m.title).join(', ')}`
        );
      }
    } catch {
      Alert.alert('Error', 'Could not process the link. Please try again.');
    }
  }, [linkUrl, processLink, queryClient]);

  const handleDelete = useCallback(
    (id: number) => {
      Alert.alert('Remove from Locker', 'Remove this film?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (Platform.OS !== 'web') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }
            try {
              await deleteMovie({ id });
              await queryClient.invalidateQueries({ queryKey: getListMoviesQueryKey() });
            } catch {
              Alert.alert('Error', 'Could not remove the film.');
            }
          },
        },
      ]);
    },
    [deleteMovie, queryClient]
  );

  const renderMovie = useCallback(
    ({ item }: { item: Movie }) => (
      <MovieCard
        id={item.id}
        title={item.title}
        releaseYear={item.releaseYear}
        posterUrl={item.posterUrl}
        rating={item.rating}
        onPress={() => setSelectedMovie(item)}
        onLongPress={handleDelete}
      />
    ),
    [handleDelete]
  );

  const ListHeader = (
    <View>
      {/* Screen header */}
      <View style={[styles.screenHeader, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
        <Text style={styles.screenTitle}>My Watchlist</Text>
        <View style={[styles.countBadge]}>
          <Text style={styles.countText}>{watchlistMovies.length}</Text>
        </View>
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={16} color="#9CA3AF" style={styles.searchIcon} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search films…"
          placeholderTextColor="#9CA3AF"
          style={styles.searchInput}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>

      {/* Paste social link */}
      <View style={styles.linkSection}>
        <Text style={styles.linkLabel}>PASTE A SOCIAL LINK</Text>
        <View style={styles.linkRow}>
          <TextInput
            value={linkUrl}
            onChangeText={setLinkUrl}
            placeholder="instagram.com/reel/… or tiktok.com/…"
            placeholderTextColor="#9CA3AF"
            style={styles.linkInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TouchableOpacity
            style={[styles.linkButton, (!linkUrl.trim() || isProcessing) && styles.linkButtonDisabled]}
            onPress={handleProcessLink}
            disabled={!linkUrl.trim() || isProcessing}
            activeOpacity={0.8}
          >
            {isProcessing ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        </View>
        {isProcessing && (
          <Text style={styles.processingHint}>Extracting films via Gemini…</Text>
        )}
      </View>

      {/* Filter bar */}
      <FilterBar movies={watchlistMovies} filters={filters} onChange={setFilters} />

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
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {isLoading ? (
        <>
          {ListHeader}
          <View style={styles.skeletonGrid}>
            {[...Array(6)].map((_, i) => <MovieCardSkeleton key={i} />)}
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
              <Ionicons name="bookmark-outline" size={48} color="#D1D5DB" />
              <Text style={styles.emptyTitle}>
                {searchQuery || Object.keys(filters).length > 0
                  ? 'No films match your filters'
                  : 'Your Watchlist is empty'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {searchQuery || Object.keys(filters).length > 0
                  ? 'Try clearing your search or filters'
                  : 'Paste a social link above or use the Home tab to discover films'}
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
    </KeyboardAvoidingView>
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
  screenTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#111827', letterSpacing: 0.5 },
  countBadge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  countText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: HORIZONTAL_PADDING,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#111827',
  },
  linkSection: {
    marginHorizontal: HORIZONTAL_PADDING,
    marginBottom: 4,
  },
  linkLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#9CA3AF',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  linkRow: { flexDirection: 'row', gap: 8 },
  linkInput: {
    flex: 1,
    height: 44,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#111827',
  },
  linkButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkButtonDisabled: { backgroundColor: '#93C5FD' },
  processingHint: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
    marginTop: 6,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 4,
    paddingBottom: 10,
  },
  sectionLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#9CA3AF', letterSpacing: 1.5 },
  sectionHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },
  columnWrapper: { gap: COLUMN_GAP, marginBottom: COLUMN_GAP },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: COLUMN_GAP,
  },
  emptyState: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#374151', marginTop: 16, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginTop: 8, textAlign: 'center', lineHeight: 20 },
});
