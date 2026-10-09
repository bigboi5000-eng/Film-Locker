import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { SignedOutGate } from '@/components/SignedOutGate';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useToast } from '@/components/ToastProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import {
  useListMovies,
  getListMoviesQueryKey,
  useDeleteMovie,
  useSearchMovies,
  getSearchMoviesQueryKey,
  type Movie,
  type TmdbMovieCard,
  type GeminiMovieMatch,
} from '@workspace/api-client-react';
import { MovieCard, MovieCardSkeleton } from '@/components/MovieCard';
import { FilmDetailModal } from '@/components/FilmDetailModal';
import { FilterBar, FilterState, applyFilters } from '@/components/FilterBar';
import { ShareFilmSheet } from '@/components/ShareFilmSheet';
import { confirmDestructive } from '@/lib/confirm';
import {
  useFilmSearchTools,
  FilmSearchBar,
  AiResultRow,
  looksLikeUrl,
  looksLikeSentence,
} from '@/components/FilmSearchTools';

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
  const router = useRouter();
  const { isSignedIn } = useAuth();

  /**
   * Searching films needs no account; identifying them from a link or photo,
   * and asking for recommendations, all exist to fill your own locker. A
   * guest gets told why rather than nothing happening.
   */
  const requireAccount = useCallback(
    (action: string) => {
      if (isSignedIn) return true;
      Alert.alert(
        'Account needed',
        `Create a free account to ${action}. Searching and browsing films works without one.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Create account', onPress: () => router.push('/(auth)/sign-up') },
        ]
      );
      return false;
    },
    [isSignedIn, router]
  );
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<FilterState>({});
  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);
  const [resultMatches, setResultMatches] = useState<GeminiMovieMatch[]>([]);
  const [resultListTitle, setResultListTitle] = useState<string | null>(null);
  const [showResultSheet, setShowResultSheet] = useState(false);

  /**
   * The camera, the link pipeline and the recommendation bar, shared with
   * Home. Results from a link or a photo land in the same confirmation sheet
   * either way, so one callback covers both.
   */
  const tools = useFilmSearchTools({
    requireAccount,
    onMatches: useCallback((matches: GeminiMovieMatch[], listTitle: string | null) => {
      setResultMatches(matches);
      setResultListTitle(listTitle);
      setShowResultSheet(true);
    }, []),
  });

  const debouncedQuery = useDebounce(searchQuery.trim(), SEARCH_DEBOUNCE_MS);
  const isSearchActive =
    debouncedQuery.length >= 2 && !looksLikeUrl(debouncedQuery) && !looksLikeSentence(debouncedQuery);

  // The locker is this user's own films — nothing to fetch without an
  // account, and it would 401 on every render for a guest.
  const { data: moviesData, isLoading, isRefetching, refetch } = useListMovies(
    { query: { queryKey: getListMoviesQueryKey(), enabled: Boolean(isSignedIn) } }
  );
  const { mutateAsync: deleteMovie } = useDeleteMovie();

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

  const handleCloseResultSheet = useCallback(() => {
    setShowResultSheet(false);
    setResultMatches([]);
    setResultListTitle(null);
    queryClient.invalidateQueries({ queryKey: getListMoviesQueryKey() });
  }, [queryClient]);

  const handleDelete = useCallback(
    (id: number) => {
      const title = allMovies.find((m) => m.id === id)?.title ?? 'this film';
      confirmDestructive(`Would you like to remove "${title}" from your watchlist?`, 'Remove', async () => {
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

  const openAiResultModal = useCallback(
    (match: GeminiMovieMatch, savedMovie?: Movie) => {
      if (match.tmdb_id == null) return;
      setModalTarget({
        tmdbId: match.tmdb_id,
        title: match.title ?? match.movie_title,
        posterUrl: match.poster_url ?? '',
        releaseYear: match.release_year,
        overview: match.overview ?? '',
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

  const renderAiResult = useCallback(
    ({ item }: { item: GeminiMovieMatch }) => {
      const saved = item.tmdb_id != null ? savedByTmdbId.get(item.tmdb_id) : undefined;
      return (
        <AiResultRow
          match={item}
          isSaved={Boolean(saved)}
          savedMovie={saved}
          onPress={openAiResultModal}
        />
      );
    },
    [savedByTmdbId, openAiResultModal]
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
          { paddingTop: insets.top },
        ]}
      >
        <Text style={styles.screenTitle}>My Watchlist</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{watchlistMovies.length}</Text>
        </View>
      </View>

      {/* The bar itself lives in FilmSearchTools, shared with Home — see the
          note there on why it is a hook plus a presentational component
          rather than one piece. */}
      <FilmSearchBar tools={tools} query={searchQuery} onQueryChange={setSearchQuery} />
      {(tools.isProcessingLink || tools.isRecommending || tools.isExtractingImage) && (
        <Text style={styles.processingHint}>
          {tools.isProcessingLink
            ? 'Extracting films via Gemini…'
            : tools.isExtractingImage
              ? 'Reading films from your image…'
              : 'Asking Gemini for a recommendation…'}
        </Text>
      )}

      {/* Filter bar — hidden while searching or asking the AI */}
      {!isSearchActive && !tools.aiOpen && (
        <FilterBar movies={watchlistMovies} filters={filters} onChange={setFilters} />
      )}

      {/* Context label row */}
      {tools.aiOpen ? (
        tools.aiResults.length > 0 && (
          <View style={styles.sectionLabelRow}>
            <Text style={styles.sectionLabel}>
              TOP {tools.aiResults.length} RECOMMENDATION{tools.aiResults.length === 1 ? '' : 'S'}
            </Text>
          </View>
        )
      ) : isSearchActive ? (
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
      {tools.aiOpen ? (
        /* AI RECOMMENDATIONS — plain tappable list, no chat, top 6 max */
        <FlatList<GeminiMovieMatch>
          key="ai-results"
          data={tools.aiResults}
          keyExtractor={(item, index) => `ai-${item.tmdb_id ?? index}`}
          renderItem={renderAiResult}
          ListEmptyComponent={
            tools.isRecommending ? (
              <View style={styles.searchingState}>
                <ActivityIndicator color="#0066FF" />
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="sparkles" size={48} color="#D1D5DB" />
                <Text style={styles.emptyTitle}>Ask for a recommendation</Text>
                <Text style={styles.emptySubtitle}>
                  e.g. "a 90 minute horror film similar to Texas Chainsaw"
                </Text>
              </View>
            )
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      ) : isSearchActive ? (
        /* SEARCH RESULTS */
        <FlatList<TmdbMovieCard>
          key="search-results"
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
        /* Signed out: the search above still works, because searching films
           is browsing and guideline 5.1.1(v) requires that to need no
           account. Only the saved list is account based, so only it is
           replaced. */
        !isSignedIn ? (
          <SignedOutGate
            icon="bookmark-outline"
            title="Your watchlist lives here"
            blurb="Search films above without an account. Saving them to a list, rating them and sharing them needs one."
          />
        ) : (
        /* WATCHLIST GRID */
        <FlatList<Movie>
          key="watchlist-grid"
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
                  : 'Search, paste a social link, or ask above for a recommendation'}
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
        )
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

      {/* Link/recommendation results — individual add for 1-2 films, playlist/watchlist/both picker for 3+ */}
      <ShareFilmSheet
        visible={showResultSheet}
        matches={resultMatches}
        listTitle={resultListTitle}
        onClose={handleCloseResultSheet}
        exitAppOnReturn={false}
      />
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

  // Search / paste-link bar, plus the separate AI recommendation bar
  // Same shape as searchContainer but blue-tinted, so it reads as a distinct
  // "AI mode" even mid-animation. Width is driven by the animated `flex`
  // style prop passed alongside this at the call site, not by anything here.
  processingHint: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
    marginHorizontal: HORIZONTAL_PADDING,
    marginBottom: 8,
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

