import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  useGetTrending,
  useGetNewReleases,
  useGetRecommendations,
  useListMovies,
  type TmdbMovieCard,
} from '@workspace/api-client-react';
import { DiscoverCard } from '@/components/DiscoverCard';
import { FilmDetailModal } from '@/components/FilmDetailModal';
import { FilterBar, FilterState, applyFilters } from '@/components/FilterBar';
import { applySort, type SortState } from '@/components/SortSheet';
import { webInputReset } from '@/lib/webInputReset';
import { getDeviceRegion } from '@/lib/region';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

// ── Section config ────────────────────────────────────────────────────────────

/** What "as listed" means on each of these, since it is not the same thing. */
const DEFAULT_ORDER_LABEL: Record<string, string> = {
  trending: 'Trending order',
  'new-releases': 'Release order',
  recommendations: 'Best match',
};

const SECTION_META: Record<string, { title: string; emoji: string }> = {
  trending: { emoji: '🔥', title: 'Trending This Week' },
  'new-releases': { emoji: '🎬', title: 'New Releases' },
  recommendations: { emoji: '✨', title: 'Recommended for You' },
};

// ── Layout ────────────────────────────────────────────────────────────────────

const COLS = 3;
const GAP = 10;
const H_PAD = 16;
const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = Math.floor((SCREEN_W - H_PAD * 2 - GAP * (COLS - 1)) / COLS);
const CARD_H = Math.round(CARD_W * 1.5);

// ── Sort types ────────────────────────────────────────────────────────────────

/**
 * Sorting here used to be three chips offering the release year and nothing
 * else, with its own SortKey, its own comparator and its own row of
 * buttons. It is the shared sheet now, which brings rating, runtime and
 * title with it, and a second place to fix whenever sorting changes has
 * stopped existing.
 */
// ── Screen ────────────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { section } = useLocalSearchParams<{ section: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const meta = SECTION_META[section ?? ''] ?? { emoji: '🎥', title: 'Explore' };

  const [query, setQuery] = useState('');
  /**
   * As TMDB listed it, which on these screens is the answer rather than the
   * absence of one — trending IS a ranking, and reordering it by title
   * throws away the only thing that made the list worth showing.
   */
  const [sort, setSort] = useState<SortState>({ key: 'none', direction: 'desc' });
  const [filters, setFilters] = useState<FilterState>({});
  const [selectedMovie, setSelectedMovie] = useState<TmdbMovieCard | null>(null);

  const region = useMemo(() => getDeviceRegion(), []);

  // Fetch data for whichever section we're in
  const { data: trendingData, isLoading: trendingLoading } = useGetTrending({ region });
  const { data: newReleasesData, isLoading: newReleasesLoading } = useGetNewReleases({ region });
  const { data: recommendationsData, isLoading: recommendationsLoading } = useGetRecommendations({ region });
  const { data: lockerData } = useListMovies();

  const rawMovies: TmdbMovieCard[] = useMemo(() => {
    if (section === 'trending') return trendingData?.movies ?? [];
    if (section === 'new-releases') return newReleasesData?.movies ?? [];
    if (section === 'recommendations') return recommendationsData?.movies ?? [];
    return [];
  }, [section, trendingData, newReleasesData, recommendationsData]);

  const isLoading =
    (section === 'trending' && trendingLoading) ||
    (section === 'new-releases' && newReleasesLoading) ||
    (section === 'recommendations' && recommendationsLoading);

  // Apply search + genre/attr filters + sort
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const searched = q
      ? rawMovies.filter((m) => m.title.toLowerCase().includes(q))
      : rawMovies;
    const filterApplied = applyFilters(searched, filters);
    return applySort(filterApplied, sort);
  }, [rawMovies, query, filters, sort]);

  const hasActiveFilters = Object.values(filters).some(Boolean);

  // For the modal: find the saved version if it exists
  const savedVersion = selectedMovie
    ? lockerData?.movies.find((m) => m.tmdbId === selectedMovie.tmdbId)
    : undefined;

  const handleBack = useCallback(() => router.back(), [router]);

  const renderItem = useCallback(
    ({ item, index }: { item: TmdbMovieCard; index: number }) => {
      const col = index % COLS;
      return (
        <View style={{ marginLeft: col === 0 ? 0 : GAP, marginBottom: GAP }}>
          <DiscoverCard movie={item} onPress={setSelectedMovie} width={CARD_W} height={CARD_H} />
        </View>
      );
    },
    []
  );

  const keyExtractor = useCallback(
    (item: TmdbMovieCard) => `${section}-${item.tmdbId}`,
    [section]
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>
            {meta.emoji} {meta.title}
          </Text>
          {!isLoading && (
            <Text style={styles.headerCount}>
              {filtered.length} film{filtered.length !== 1 ? 's' : ''}
            </Text>
          )}
        </View>
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.textFaint} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by title…"
            placeholderTextColor={colors.textFaint}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
        </View>
      </View>

      {/* Sort chips */}

      {/* Filter bar — Genre, Director, Actor, Language, Streaming */}
      <FilterBar
        movies={rawMovies}
        filters={filters}
        onChange={setFilters}
        sort={sort}
        onSortChange={setSort}
        // No "date added" or "date watched": these are films from TMDB, not
        // rows in anybody's locker. "Your rating" stays, since a film you
        // have already rated can perfectly well turn up in trending.
        sortOptions={['none', 'tmdbRating', 'runtime', 'year', 'title', 'myRating']}
        sortDefault={{ key: 'none', direction: 'desc' }}
        sortDefaultLabel={DEFAULT_ORDER_LABEL[section ?? ''] ?? 'As listed'}
      />

      {/* Content */}
      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No films found</Text>
          <Text style={styles.emptySubtitle}>
            {query || hasActiveFilters
              ? 'Try clearing your search or filters.'
              : 'Check back soon.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          numColumns={COLS}
          contentContainerStyle={[
            styles.grid,
            { paddingBottom: insets.bottom + 24 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        />
      )}

      {/* Film detail modal */}
      {selectedMovie && (
        <FilmDetailModal
          visible
          onClose={() => setSelectedMovie(null)}
          tmdbId={selectedMovie.tmdbId}
          title={selectedMovie.title}
          posterUrl={selectedMovie.posterUrl}
          releaseYear={selectedMovie.releaseYear}
          overview={selectedMovie.overview}
          savedMovie={savedVersion}
        />
      )}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    gap: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: c.text,
  },
  headerCount: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: c.textMuted,
    marginTop: 1,
  },

  // Search
  searchRow: {
    paddingHorizontal: H_PAD,
    paddingVertical: 12,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: c.text,
    height: '100%',
    ...webInputReset,
  },

  // Grid
  grid: { paddingHorizontal: H_PAD, paddingTop: 2 },

  // States
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: c.text,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: c.textMuted,
    textAlign: 'center',
  },
});
