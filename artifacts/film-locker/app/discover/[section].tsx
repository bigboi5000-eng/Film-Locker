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
  Platform,
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

// ── Section config ────────────────────────────────────────────────────────────

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

type SortKey = 'default' | 'newest' | 'oldest';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'default', label: 'Most Popular' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
];

function sortMovies(movies: TmdbMovieCard[], sort: SortKey): TmdbMovieCard[] {
  if (sort === 'default') return movies;
  return [...movies].sort((a, b) => {
    const ya = parseInt(a.releaseYear || '0', 10);
    const yb = parseInt(b.releaseYear || '0', 10);
    return sort === 'newest' ? yb - ya : ya - yb;
  });
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const meta = SECTION_META[section ?? ''] ?? { emoji: '🎥', title: 'Explore' };

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('default');
  const [selectedMovie, setSelectedMovie] = useState<TmdbMovieCard | null>(null);

  // Fetch data for whichever section we're in
  const { data: trendingData, isLoading: trendingLoading } = useGetTrending();
  const { data: newReleasesData, isLoading: newReleasesLoading } = useGetNewReleases();
  const { data: recommendationsData, isLoading: recommendationsLoading } = useGetRecommendations();
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

  // Apply search + sort
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const searched = q
      ? rawMovies.filter((m) => m.title.toLowerCase().includes(q))
      : rawMovies;
    return sortMovies(searched, sort);
  }, [rawMovies, query, sort]);

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
    <View style={[styles.root, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#111827" />
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
          <Ionicons name="search" size={16} color="#9CA3AF" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by title…"
            placeholderTextColor="#9CA3AF"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
        </View>
      </View>

      {/* Sort chips */}
      <View style={styles.sortRow}>
        {SORT_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            onPress={() => setSort(opt.key)}
            style={[styles.sortChip, sort === opt.key && styles.sortChipActive]}
            activeOpacity={0.75}
          >
            <Text style={[styles.sortChipText, sort === opt.key && styles.sortChipTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#0066FF" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No films found</Text>
          <Text style={styles.emptySubtitle}>
            {query ? 'Try a different search term.' : 'Check back soon.'}
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    gap: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: '#111827',
  },
  headerCount: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
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
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#111827',
    height: '100%',
  },

  // Sort chips
  sortRow: {
    flexDirection: 'row',
    paddingHorizontal: H_PAD,
    gap: 8,
    marginBottom: 14,
  },
  sortChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sortChipActive: { backgroundColor: '#0066FF', borderColor: '#0066FF' },
  sortChipText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#374151',
  },
  sortChipTextActive: { color: '#FFFFFF' },

  // Grid
  grid: { paddingHorizontal: H_PAD, paddingTop: 2 },

  // States
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: '#111827',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
    textAlign: 'center',
  },
});
