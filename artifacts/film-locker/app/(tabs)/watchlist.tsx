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
import { applySort, DEFAULT_SORT, type SortState } from '@/components/SortSheet';
import { ShareFilmSheet } from '@/components/ShareFilmSheet';
import { confirmDestructive } from '@/lib/confirm';
import {
  useFilmSearchTools,
  FilmSearchBar,
  AiResultRow,
  looksLikeUrl,
  looksLikeSentence,
} from '@/components/FilmSearchTools';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

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
        {movie.releaseYear ? (
          <Text style={styles.resultYear}>{movie.releaseYear}</Text>
        ) : null}
      </View>
      {isSaved && (
        <View style={styles.savedBadge}>
          <Ionicons name="bookmark" size={14} color={colors.onColor} />
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

/**
 * Watchlist and Watched, which were two tabs.
 *
 * They were the same grid over the same query filtered two ways, with the
 * same filters and the same card, and keeping them apart cost a tab slot
 * for no difference. The toggle at the top is the whole distinction now.
 *
 * The route is still "watchlist". Both the share handler and the film
 * modal navigate to it by name, and the tab's label is not its path.
 */
type FilmsMode = 'watchlist' | 'watched';

export default function WatchlistScreen() {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
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
  const [mode, setMode] = useState<FilmsMode>('watchlist');
  // Cleared on switching: the two lists rarely share a director or a
  // streaming service, so carrying a filter across usually lands on an
  // empty grid that looks like the switch did nothing.
  const [filters, setFilters] = useState<FilterState>({});
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const switchMode = useCallback((next: FilmsMode) => {
    setMode(next);
    setFilters({});
    // The sort goes back too. "Date watched" is not an order a watchlist
    // has, so carrying it across would leave the other tab sorted by a
    // value every film in it is missing.
    setSort(DEFAULT_SORT);
  }, []);
  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);
  const [resultMatches, setResultMatches] = useState<GeminiMovieMatch[]>([]);
  const [resultListTitle, setResultListTitle] = useState<string | null>(null);
  /** The link these results came from, carried into whatever gets saved. */
  const [resultSourceUrl, setResultSourceUrl] = useState<string | null>(null);
  const [showResultSheet, setShowResultSheet] = useState(false);

  /**
   * The camera, the link pipeline and the recommendation bar, shared with
   * Home. Results from a link or a photo land in the same confirmation sheet
   * either way, so one callback covers both.
   */
  const tools = useFilmSearchTools({
    requireAccount,
    onMatches: useCallback((matches: GeminiMovieMatch[], listTitle: string | null, src: string | null) => {
      setResultMatches(matches);
      setResultListTitle(listTitle);
      setResultSourceUrl(src);
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
  // The same query, split the way the toggle asks for it.
  const watchlistMovies = useMemo(
    () => allMovies.filter((m) => (mode === 'watched' ? m.isWatched : !m.isWatched)),
    [allMovies, mode]
  );
  const watchedCount = useMemo(() => allMovies.filter((m) => m.isWatched).length, [allMovies]);
  const watchlistCount = allMovies.length - watchedCount;

  // Map tmdbId → saved Movie for quick look-up in search results
  const savedByTmdbId = useMemo(
    () => new Map(allMovies.map((m) => [m.tmdbId, m])),
    [allMovies]
  );

  const filteredMovies = useMemo(
    // Sorted after filtering rather than before: ordering a list and then
    // removing most of it does the same work twice.
    () => applySort(applyFilters(watchlistMovies, filters), sort),
    [watchlistMovies, filters, sort]
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
      const from = mode === 'watched' ? 'Watched list' : 'watchlist';
      confirmDestructive(`Would you like to remove "${title}" from your ${from}?`, 'Remove', async () => {
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
    [deleteMovie, queryClient, allMovies, mode]
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
        isWatched={item.isWatched}
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
      <View style={[styles.screenHeader, { paddingTop: insets.top }]}>
        {/*
          Two tabs along the top, drawn the way a browser draws them: the
          selected one joins the page below it, the other sits behind. That
          is the whole affordance — it says these are two views of one place
          rather than two places.
        */}
        <View style={styles.folderRow}>
          {(['watchlist', 'watched'] as FilmsMode[]).map((m) => {
            const active = mode === m;
            return (
              <TouchableOpacity
                key={m}
                style={[styles.folderTab, active && styles.folderTabActive]}
                onPress={() => switchMode(m)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={m === 'watched' ? 'checkmark-circle' : 'bookmark'}
                  size={15}
                  color={active ? colors.primary : colors.textFaint}
                />
                <Text style={[styles.folderText, active && styles.folderTextActive]}>
                  {m === 'watched' ? 'Watched' : 'Watchlist'}
                </Text>
                <View style={[styles.folderCount, active && styles.folderCountActive]}>
                  <Text style={[styles.folderCountText, active && styles.folderCountTextActive]}>
                    {m === 'watched' ? watchedCount : watchlistCount}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
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
        <FilterBar
          movies={watchlistMovies}
          filters={filters}
          onChange={setFilters}
          sort={sort}
          onSortChange={setSort}
          // "Date watched" is only an order on a list of watched films.
          showWatchedSort={mode === 'watched'}
        />
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
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="sparkles" size={48} color={colors.iconFaint} />
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
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="film-outline" size={48} color={colors.iconFaint} />
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
          numColumns={3}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={[
            styles.contentContainer,
            { paddingBottom: insets.bottom + 16 },
          ]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons
                name={mode === 'watched' ? 'checkmark-circle-outline' : 'bookmark-outline'}
                size={48}
                color={colors.iconFaint}
              />
              <Text style={styles.emptyTitle}>
                {Object.keys(filters).length > 0
                  ? 'No films match your filters'
                  : mode === 'watched'
                    ? 'Nothing watched yet'
                    : 'Your Watchlist is empty'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {Object.keys(filters).length > 0
                  ? 'Try clearing your filters'
                  : mode === 'watched'
                    ? 'Open a film from your Watchlist and mark it watched to see it here'
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
              tintColor={colors.primary}
              colors={[colors.primary]}
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
        sourceUrl={resultSourceUrl}
        onClose={handleCloseResultSheet}
        exitAppOnReturn={false}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  contentContainer: { paddingHorizontal: HORIZONTAL_PADDING },

  screenHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingBottom: 0,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  folderRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, flex: 1 },
  folderTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    backgroundColor: c.surfaceAlt,
  },
  // The selected tab joins the page: it takes the page's own background and
  // sits a pixel lower, so the line under the header reads as broken by it.
  folderTabActive: { backgroundColor: c.background, marginBottom: -1, paddingBottom: 11 },
  folderText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: c.textFaint },
  folderTextActive: { color: c.text },
  folderCount: {
    minWidth: 20,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 9,
    backgroundColor: c.surfaceSubtle,
    alignItems: 'center',
  },
  folderCountActive: { backgroundColor: c.primarySoft },
  folderCountText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: c.textFaint },
  folderCountTextActive: { color: c.primary },

  // Search / paste-link bar, plus the separate AI recommendation bar
  // Same shape as searchContainer but blue-tinted, so it reads as a distinct
  // "AI mode" even mid-animation. Width is driven by the animated `flex`
  // style prop passed alongside this at the call site, not by anything here.
  processingHint: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: c.textMuted,
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
    color: c.textFaint,
    letterSpacing: 1.5,
  },
  sectionHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: c.textFaint },
  clearSearchText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: c.primary,
  },

  // Search result rows
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
  savedBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: c.primary,
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
    color: c.textStrong,
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: c.textFaint,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
  searchingState: {
    paddingVertical: 40,
    alignItems: 'center',
  },
});

