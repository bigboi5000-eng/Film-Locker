import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
  Animated,
} from 'react-native';
import { useToast } from '@/components/ToastProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import {
  useListMovies,
  useDeleteMovie,
  useProcessSocialLink,
  useRecommendMovies,
  useSearchMovies,
  getListMoviesQueryKey,
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

// ── Unified search-bar input classification ─────────────────────────────────
// The single bar handles three inputs: a pasted URL, a plain title (live TMDB
// search), or a natural-language recommendation request. No scheme required —
// people paste "instagram.com/reel/…" without "https://" all the time.
const URL_LIKE_RE = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i;
// Google's share sheet (and similar) prepends the page title before the link,
// e.g. "Schindler's List https://share.google/5PhWqNwJU80K34PTK" — that fails
// URL_LIKE_RE (it's not ENTIRELY a URL) but still needs to go through the
// link-processing path, not a literal TMDB title search for the whole string.
// The backend's processSocialLink already strips the title/URL apart
// (extractUrlFromMixedText) — this just needs to recognize and forward it.
const EMBEDDED_URL_RE = /https?:\/\/\S+/i;

function looksLikeUrl(text: string): boolean {
  const trimmed = text.trim();
  return URL_LIKE_RE.test(trimmed) || EMBEDDED_URL_RE.test(trimmed);
}

/** A multi-word request or a question reads as a recommendation ask, not a title fragment — skip the live TMDB dropdown so it doesn't flash "no results" mid-sentence. */
function looksLikeSentence(text: string): boolean {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return wordCount > 5 || text.includes('?');
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

// ── AI recommendation row — same shape as SearchResultRow, plus the
// one-sentence synopsis Gemini writes specifically for these results ──────────

interface AiResultRowProps {
  match: GeminiMovieMatch;
  isSaved: boolean;
  savedMovie?: Movie;
  onPress: (match: GeminiMovieMatch, savedMovie?: Movie) => void;
}

function AiResultRow({ match, isSaved, savedMovie, onPress }: AiResultRowProps) {
  return (
    <TouchableOpacity
      style={styles.resultRow}
      onPress={() => onPress(match, savedMovie)}
      activeOpacity={0.75}
    >
      <Image
        source={{ uri: match.poster_url ?? undefined }}
        style={styles.resultPoster}
        contentFit="cover"
        transition={200}
        placeholder={require('@/assets/images/icon.png')}
      />
      <View style={styles.resultInfo}>
        <Text style={styles.resultTitle} numberOfLines={2}>
          {match.title ?? match.movie_title}
        </Text>
        {match.release_year ? (
          <Text style={styles.resultYear}>{match.release_year}</Text>
        ) : null}
        {match.synopsis ? (
          <Text style={styles.resultSynopsis} numberOfLines={2}>
            {match.synopsis}
          </Text>
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

  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<FilterState>({});
  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);
  const [resultMatches, setResultMatches] = useState<GeminiMovieMatch[]>([]);
  const [resultListTitle, setResultListTitle] = useState<string | null>(null);
  const [showResultSheet, setShowResultSheet] = useState(false);

  // AI recommendation bar — separate from the main search bar, revealed by
  // tapping the sparkles toggle. aiVisible controls mounting; aiOpen is the
  // target state driving the animation direction (kept apart so the closing
  // animation gets to finish playing before the bar unmounts).
  const [aiVisible, setAiVisible] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiQuery, setAiQuery] = useState('');
  const [aiResults, setAiResults] = useState<GeminiMovieMatch[]>([]);
  const [searchRowWidth, setSearchRowWidth] = useState(0);
  const aiAnim = useRef(new Animated.Value(0)).current;
  const aiInputRef = useRef<TextInput>(null);
  // Row minus the fixed 44px toggle button and the 8px gap between them —
  // the pixel width the AI bar animates open to. Flex can't be animated
  // smoothly here since it's the row's only flex-grow child (nothing to
  // proportionally share space with), so this measures a concrete target.
  const aiTargetWidth = Math.max(searchRowWidth - 44 - 8, 0);

  const debouncedQuery = useDebounce(searchQuery.trim(), SEARCH_DEBOUNCE_MS);
  const isSearchActive =
    debouncedQuery.length >= 2 && !looksLikeUrl(debouncedQuery) && !looksLikeSentence(debouncedQuery);

  const { data: moviesData, isLoading, isRefetching, refetch } = useListMovies();
  const { mutateAsync: deleteMovie } = useDeleteMovie();
  const { mutateAsync: processLink, isPending: isProcessingLink } = useProcessSocialLink();
  const { mutateAsync: recommend, isPending: isRecommending } = useRecommendMovies();

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

  // Main bar submit — URL only now that AI has its own bar. Dry-run: identify
  // films without saving, then let ShareFilmSheet decide the flow —
  // individual add-to-watchlist for 1-2 films, or a playlist/watchlist/both
  // prompt (prefilled with a detected list title) for 3 or more.
  const handleSubmit = useCallback(async () => {
    const trimmed = searchQuery.trim();
    if (!trimmed || !looksLikeUrl(trimmed) || isProcessingLink) return;
    try {
      const result = await processLink({ data: { url: trimmed, dryRun: true } });
      setSearchQuery('');
      const matches = result.matches ?? [];
      if (matches.length === 0) {
        showToast({
          title: 'No Films Found',
          subtitle:
            result.source === 'none'
              ? 'Could not extract any titles from this link.'
              : `Processed via ${result.source} — no recognizable titles found.`,
          variant: 'error',
        });
        return;
      }
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setResultMatches(matches);
      setResultListTitle(result.listTitle ?? null);
      setShowResultSheet(true);
    } catch {
      Alert.alert('Error', 'Could not process the link. Please try again.');
    }
  }, [searchQuery, isProcessingLink, processLink, showToast]);

  // AI bar submit — renders as a plain tappable results list (top 5, no
  // Gemini prose) below the bar, the same as a TMDB search result list.
  // Not a chat: one request in, a short list out, nothing conversational.
  const handleAiSubmit = useCallback(async () => {
    const trimmed = aiQuery.trim();
    if (!trimmed || isRecommending) return;
    setAiResults([]);
    try {
      const result = await recommend({ data: { query: trimmed, dryRun: true } });
      if (result.offTopic) {
        showToast({
          title: 'Film & TV only',
          subtitle: 'Try something like "a 90 minute horror film similar to Texas Chainsaw".',
          variant: 'error',
        });
        return;
      }
      const matches = (result.matches ?? []).filter((m) => m.tmdb_id != null).slice(0, 6);
      if (matches.length === 0) {
        showToast({
          title: 'No Recommendations Found',
          subtitle: 'Try rephrasing your request.',
          variant: 'error',
        });
        return;
      }
      setAiResults(matches);
    } catch {
      Alert.alert('Error', 'Could not get a recommendation. Please try again.');
    }
  }, [aiQuery, isRecommending, recommend, showToast]);

  // Grows the AI bar open from the left (flex 0 → 1, sibling toggle button
  // stays fixed-width so the box fills exactly the remaining row space) and
  // shrinks it closed again — aiVisible unmounts only once the closing
  // animation has actually finished playing.
  const toggleAiSearch = useCallback(() => {
    if (!aiOpen) {
      setAiVisible(true);
      setAiOpen(true);
      Animated.timing(aiAnim, { toValue: 1, duration: 260, useNativeDriver: false }).start(() => {
        setTimeout(() => aiInputRef.current?.focus(), 30);
      });
    } else {
      setAiOpen(false);
      Animated.timing(aiAnim, { toValue: 0, duration: 220, useNativeDriver: false }).start(() => {
        setAiVisible(false);
        setAiQuery('');
        setAiResults([]);
      });
    }
  }, [aiOpen, aiAnim]);

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

      {/* Search / paste-link bar, plus a separate AI recommendation bar that
          grows open from the sparkles toggle — kept apart so typing in either
          one never resizes or shifts the other. */}
      <View
        style={styles.searchRow}
        onLayout={(e) => setSearchRowWidth(e.nativeEvent.layout.width)}
      >
        {aiVisible ? (
          <Animated.View
            style={[
              styles.aiContainer,
              { width: aiAnim.interpolate({ inputRange: [0, 1], outputRange: [0, aiTargetWidth] }) },
            ]}
          >
            <Ionicons name="sparkles" size={15} color="#0066FF" style={styles.searchIcon} />
            <TextInput
              ref={aiInputRef}
              value={aiQuery}
              onChangeText={setAiQuery}
              placeholder="Ask for a recommendation…"
              placeholderTextColor="#9CA3AF"
              style={styles.searchInput}
              returnKeyType="go"
              onSubmitEditing={handleAiSubmit}
            />
            {isRecommending && <ActivityIndicator color="#0066FF" size="small" />}
          </Animated.View>
        ) : (
          <View style={styles.searchContainer}>
            <Ionicons name="search-outline" size={16} color="#9CA3AF" style={styles.searchIcon} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search a film or paste a social link…"
              placeholderTextColor="#9CA3AF"
              style={styles.searchInput}
              returnKeyType="go"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleSubmit}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8} style={{ marginRight: 6 }}>
                <Ionicons name="close-circle" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            )}
            {looksLikeUrl(searchQuery.trim()) && (
              <TouchableOpacity onPress={handleSubmit} disabled={isProcessingLink} hitSlop={8}>
                {isProcessingLink ? (
                  <ActivityIndicator color="#0066FF" size="small" />
                ) : (
                  <Ionicons name="arrow-forward-circle" size={24} color="#0066FF" />
                )}
              </TouchableOpacity>
            )}
          </View>
        )}
        <TouchableOpacity
          style={styles.aiToggleBtn}
          onPress={toggleAiSearch}
          activeOpacity={0.8}
        >
          <Ionicons name={aiOpen ? 'close' : 'sparkles'} size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
      {(isProcessingLink || isRecommending) && (
        <Text style={styles.processingHint}>
          {isProcessingLink ? 'Extracting films via Gemini…' : 'Asking Gemini for a recommendation…'}
        </Text>
      )}

      {/* Filter bar — hidden while searching or asking the AI */}
      {!isSearchActive && !aiOpen && (
        <FilterBar movies={watchlistMovies} filters={filters} onChange={setFilters} />
      )}

      {/* Context label row */}
      {aiOpen ? (
        aiResults.length > 0 && (
          <View style={styles.sectionLabelRow}>
            <Text style={styles.sectionLabel}>
              TOP {aiResults.length} RECOMMENDATION{aiResults.length === 1 ? '' : 'S'}
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
      {aiOpen ? (
        /* AI RECOMMENDATIONS — plain tappable list, no chat, top 6 max */
        <FlatList<GeminiMovieMatch>
          key="ai-results"
          data={aiResults}
          keyExtractor={(item, index) => `ai-${item.tmdb_id ?? index}`}
          renderItem={renderAiResult}
          ListEmptyComponent={
            isRecommending ? (
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: HORIZONTAL_PADDING,
    marginTop: HORIZONTAL_PADDING,
    marginBottom: 8,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  // Same shape as searchContainer but blue-tinted, so it reads as a distinct
  // "AI mode" even mid-animation. Width is driven by the animated `flex`
  // style prop passed alongside this at the call site, not by anything here.
  aiContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 12,
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#93C5FD',
    overflow: 'hidden',
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#111827',
    // react-native-web never resets the browser's default focus outline on
    // the underlying <input> — without this, focusing/typing draws a
    // separate black ring around just the input, distinct from the
    // intended pill border around it.
    borderWidth: 0,
    ...(Platform.OS === 'web' ? { outlineWidth: 0 } : null),
  },
  aiToggleBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  resultSynopsis: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
    marginTop: 4,
    lineHeight: 16,
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
