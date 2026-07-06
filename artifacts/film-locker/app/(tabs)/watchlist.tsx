import React, { useState, useCallback, useMemo, useEffect } from 'react';
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
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import {
  useListMovies,
  useDeleteMovie,
  useProcessSocialLink,
  useSearchMovies,
  getListMoviesQueryKey,
  getSearchMoviesQueryKey,
  type Movie,
  type TmdbMovieCard,
} from '@workspace/api-client-react';
import { MovieCard, MovieCardSkeleton } from '@/components/MovieCard';
import { FilmDetailModal } from '@/components/FilmDetailModal';
import { FilterBar, FilterState, applyFilters } from '@/components/FilterBar';

const HORIZONTAL_PADDING = 16;
const COLUMN_GAP = 10;
const SEARCH_DEBOUNCE_MS = 400;

// ── Simple debounce hook ──────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ── Search result row ─────────────────────────────────────────────────────────

interface SearchResultRowProps {
  movie: TmdbMovieCard;
  isSaved: boolean;
  savedMovie?: Movie;
  onPress: (movie: TmdbMovieCard, savedMovie?: Movie) => void;
}

function SearchResultRow({ movie, isSaved, savedMovie, onPress }: SearchResultRowProps) {
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
        {movie.releaseYear ? (
          <Text style={styles.resultYear}>{movie.releaseYear}</Text>
        ) : null}
      </View>
      {isSaved && (
        <View style={styles.savedBadge}>
          <Ionicons name="bookmark" size={14} color="#FFFFFF" />
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Modal selection state ─────────────────────────────────────────────────────

interface ModalTarget {
  tmdbId: number;
  title: string;
  posterUrl: string;
  releaseYear: string;
  overview: string;
  savedMovie?: Movie;
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function WatchlistScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [filters, setFilters] = useState<FilterState>({});
  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);

  const debouncedQuery = useDebounce(searchQuery.trim(), SEARCH_DEBOUNCE_MS);
  const isSearchActive = debouncedQuery.length >= 2;

  const { data: moviesData, isLoading, isRefetching, refetch } = useListMovies();
  const { mutateAsync: deleteMovie } = useDeleteMovie();
  const { mutateAsync: processLink, isPending: isProcessing } = useProcessSocialLink();

  // TMDB search — only fires when query has ≥ 2 chars.
  // params.q and queryKey both derive from debouncedQuery so they stay aligned;
  // when disabled the fetch never runs so the empty-string param is harmless.
  const {
    data: searchData,
    isFetching: isSearchFetching,
  } = useSearchMovies(
    { q: debouncedQuery || '' },
    {
      query: {
        enabled: isSearchActive,
        queryKey: getSearchMoviesQueryKey({ q: debouncedQuery }),
      },
    }
  );

  const allMovies = moviesData?.movies ?? [];
  const watchlistMovies = allMovies.filter((m) => !m.isWatched);

  // Map tmdbId → saved Movie for quick look-up in search results
  const savedByTmdbId = useMemo(
    () => new Map(allMovies.map((m) => [m.tmdbId, m])),
    [allMovies]
  );

  const filteredMovies = useMemo(
    () => applyFilters(watchlistMovies, filters),
    [watchlistMovies, filters]
  );

  const searchResults = searchData?.movies ?? [];

  // ── Handlers ────────────────────────────────────────────────────────────────

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

  const openMovieModal = useCallback(
    (movie: TmdbMovieCard, savedMovie?: Movie) => {
      setModalTarget({
        tmdbId: movie.tmdbId,
        title: movie.title,
        posterUrl: movie.posterUrl,
        releaseYear: movie.releaseYear,
        overview: movie.overview,
        savedMovie,
      });
    },
    []
  );

  const openSavedMovieModal = useCallback((movie: Movie) => {
    setModalTarget({
      tmdbId: movie.tmdbId,
      title: movie.title,
      posterUrl: movie.posterUrl,
      releaseYear: movie.releaseYear,
      overview: movie.overview,
      savedMovie: movie,
    });
  }, []);

  // ── Renderers ────────────────────────────────────────────────────────────────

  const renderSearchResult = useCallback(
    ({ item }: { item: TmdbMovieCard }) => {
      const saved = savedByTmdbId.get(item.tmdbId);
      return (
        <SearchResultRow
          movie={item}
          isSaved={Boolean(saved)}
          savedMovie={saved}
          onPress={openMovieModal}
        />
      );
    },
    [savedByTmdbId, openMovieModal]
  );

  const renderWatchlistMovie = useCallback(
    ({ item }: { item: Movie }) => (
      <MovieCard
        id={item.id}
        title={item.title}
        releaseYear={item.releaseYear}
        posterUrl={item.posterUrl}
        rating={item.rating}
        onPress={() => openSavedMovieModal(item)}
        onLongPress={handleDelete}
      />
    ),
    [handleDelete, openSavedMovieModal]
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      {/*
       * STABLE HEADER — lives outside any FlatList so these TextInputs never
       * remount on keystroke. Putting inputs inside ListHeaderComponent causes
       * React Native to unmount/remount the header element whenever its deps
       * change, killing focus and crashing the layout cycle.
       */}
      <View
        style={[
          styles.screenHeader,
          { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) },
        ]}
      >
        <Text style={styles.screenTitle}>My Watchlist</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{watchlistMovies.length}</Text>
        </View>
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={16} color="#9CA3AF" style={styles.searchIcon} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search any film…"
          placeholderTextColor="#9CA3AF"
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>

      {/* Paste social link — hidden while searching */}
      {!isSearchActive && (
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
              style={[
                styles.linkButton,
                (!linkUrl.trim() || isProcessing) && styles.linkButtonDisabled,
              ]}
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
      )}

      {/* Filter bar — only when not searching */}
      {!isSearchActive && (
        <FilterBar movies={watchlistMovies} filters={filters} onChange={setFilters} />
      )}

      {/* Context label row */}
      {isSearchActive ? (
        <View style={styles.sectionLabelRow}>
          <Text style={styles.sectionLabel}>
            {isSearchFetching
              ? 'SEARCHING TMDB…'
              : `${searchResults.length} RESULT${searchResults.length === 1 ? '' : 'S'}`}
          </Text>
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
            <Text style={styles.clearSearchText}>Clear Search</Text>
          </TouchableOpacity>
        </View>
      ) : filteredMovies.length > 0 ? (
        <View style={styles.sectionLabelRow}>
          <Text style={styles.sectionLabel}>
            {filteredMovies.length} FILM{filteredMovies.length === 1 ? '' : 'S'}
          </Text>
          <Text style={styles.sectionHint}>Hold to remove</Text>
        </View>
      ) : null}

      {/* ── LIST AREA ── */}
      {isSearchActive ? (
        /* SEARCH RESULTS */
        <FlatList<TmdbMovieCard>
          data={searchResults}
          keyExtractor={(item) => String(item.tmdbId)}
          renderItem={renderSearchResult}
          ListEmptyComponent={
            isSearchFetching ? (
              <View style={styles.searchingState}>
                <ActivityIndicator color="#0066FF" />
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="film-outline" size={48} color="#D1D5DB" />
                <Text style={styles.emptyTitle}>No films found</Text>
                <Text style={styles.emptySubtitle}>
                  Try a different title or check your spelling
                </Text>
              </View>
            )
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      ) : isLoading ? (
        /* SKELETON */
        <View style={styles.skeletonGrid}>
          {[...Array(6)].map((_, i) => (
            <MovieCardSkeleton key={i} />
          ))}
        </View>
      ) : (
        /* WATCHLIST GRID */
        <FlatList<Movie>
          data={filteredMovies}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderWatchlistMovie}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={[
            styles.contentContainer,
            { paddingBottom: insets.bottom + 16 },
          ]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="bookmark-outline" size={48} color="#D1D5DB" />
              <Text style={styles.emptyTitle}>
                {Object.keys(filters).length > 0
                  ? 'No films match your filters'
                  : 'Your Watchlist is empty'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {Object.keys(filters).length > 0
                  ? 'Try clearing your filters'
                  : 'Search above to find films, or paste a social link'}
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
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

      {/* Film detail modal */}
      {modalTarget && (
        <FilmDetailModal
          visible
          onClose={() => setModalTarget(null)}
          tmdbId={modalTarget.tmdbId}
          title={modalTarget.title}
          posterUrl={modalTarget.posterUrl}
          releaseYear={modalTarget.releaseYear}
          overview={modalTarget.overview}
          savedMovie={modalTarget.savedMovie}
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

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
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  countText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  // Search
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

  // Social link
  linkSection: { marginHorizontal: HORIZONTAL_PADDING, marginBottom: 4 },
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

  // Section label
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
  clearSearchText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: '#0066FF',
  },

  // Search result rows
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  resultPoster: {
    width: 42,
    height: 63,
    borderRadius: 6,
    backgroundColor: '#F3F4F6',
    marginRight: 12,
  },
  resultInfo: { flex: 1 },
  resultTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#111827',
    lineHeight: 19,
  },
  resultYear: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#FF8C00',
    marginTop: 3,
  },
  savedBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },

  // Grid
  columnWrapper: { gap: COLUMN_GAP, marginBottom: COLUMN_GAP },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: COLUMN_GAP,
  },

  // Empty / loading states
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
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
  searchingState: {
    paddingVertical: 40,
    alignItems: 'center',
  },
});
