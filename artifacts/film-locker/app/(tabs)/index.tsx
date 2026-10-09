import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, useUser } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetTrending,
  useGetNewReleases,
  useGetRecommendations,
  getGetRecommendationsQueryKey,
  useListMovies,
  useSearchMovies,
  getSearchMoviesQueryKey,
  getListMoviesQueryKey,
  useGetMyPlaylists,
  useCreatePlaylist,
  useGetMe,
  getGetMyPlaylistsQueryKey,
  getGetMeQueryKey,
  type TmdbMovieCard,
  type GeminiMovieMatch,
} from '@workspace/api-client-react';
import { DiscoverCard } from '@/components/DiscoverCard';
import { FilmDetailModal } from '@/components/FilmDetailModal';
import { PlaylistCard } from '@/components/PlaylistCard';
import { CreatePlaylistModal } from '@/components/CreatePlaylistModal';
import { ShareFilmSheet } from '@/components/ShareFilmSheet';
import {
  useFilmSearchTools,
  FilmSearchBar,
  AiResultRow,
} from '@/components/FilmSearchTools';
import { getDeviceRegion } from '@/lib/region';

const CARD_W = 120;
const CARD_H = 180;

// ── Skeleton ─────────────────────────────────────────────────────────────────

function SectionSkeleton() {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
    >
      {[...Array(5)].map((_, i) => (
        <View key={i} style={{ width: CARD_W, height: CARD_H, borderRadius: 10, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#D1D5DB" size="small" />
        </View>
      ))}
    </ScrollView>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({
  title,
  section,
  seeAllHref,
  actionLabel,
  onAction,
}: {
  title: string;
  section?: string;
  /** A direct route for the "See All" link, for sections that aren't under /discover/. */
  seeAllHref?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const router = useRouter();
  const seeAllTarget = section ? `/discover/${section}` : seeAllHref;
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {seeAllTarget ? (
        <TouchableOpacity
          style={styles.seeAllBtn}
          onPress={() => router.push(seeAllTarget as never)}
          activeOpacity={0.7}
          hitSlop={8}
        >
          <Text style={styles.seeAllText}>See All</Text>
          <Ionicons name="chevron-forward" size={13} color="#0066FF" />
        </TouchableOpacity>
      ) : actionLabel ? (
        <TouchableOpacity style={styles.seeAllBtn} onPress={onAction} activeOpacity={0.7} hitSlop={8}>
          <Ionicons name="add" size={16} color="#0066FF" />
          <Text style={styles.seeAllText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── Home Screen ───────────────────────────────────────────────────────────────

/** Wait for typing to settle before querying TMDB. */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const SEARCH_DEBOUNCE_MS = 350;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();

  const [selectedMovie, setSelectedMovie] = useState<TmdbMovieCard | null>(null);
  const [createPlaylistVisible, setCreatePlaylistVisible] = useState(false);

  // Films identified from a link or a photo, awaiting confirmation.
  const [resultMatches, setResultMatches] = useState<GeminiMovieMatch[]>([]);
  const [resultListTitle, setResultListTitle] = useState<string | null>(null);
  const [showResultSheet, setShowResultSheet] = useState(false);

  /**
   * Browsing and searching need no account — that is the point of this tab.
   * Identifying films from a link or a photo, and asking for
   * recommendations, all fill a locker a guest does not have, so they say
   * why rather than failing quietly.
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

  /** The camera, the link pipeline and the recommendation bar — see the
      Watchlist, which uses the same hook. */
  const tools = useFilmSearchTools({
    requireAccount,
    onMatches: useCallback((matches: GeminiMovieMatch[], listTitle: string | null) => {
      setResultMatches(matches);
      setResultListTitle(listTitle);
      setShowResultSheet(true);
    }, []),
  });

  const region = useMemo(() => getDeviceRegion(), []);

  const { data: trendingData, isLoading: trendingLoading, refetch: refetchTrending, isRefetching: trendingRefetching } = useGetTrending({ region });
  const { data: newReleasesData, isLoading: newReleasesLoading, refetch: refetchNew, isRefetching: newRefetching } = useGetNewReleases({ region });
  // The locker is the signed-in user's own films, so there is nothing to
  // fetch without an account. It also decides whether the Recommended
  // section appears at all, which is why a guest simply does not see it.
  // Search on Home as well as on the Watchlist tab. Testers kept looking for
  // it here first, which is reasonable — Home is where you land, and the
  // search endpoint is public, so it works signed out too.
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebounce(searchQuery.trim(), SEARCH_DEBOUNCE_MS);
  const isSearching = debouncedQuery.length >= 2;

  /**
   * Open a recommendation in the usual detail sheet.
   *
   * A match carries everything the sheet needs to render immediately; the
   * rest arrives from its own TMDB lookup. Genres are empty rather than
   * guessed — the sheet fills them in.
   */
  const openAiResult = useCallback((match: GeminiMovieMatch) => {
    if (match.tmdb_id == null) return;
    setSelectedMovie({
      tmdbId: match.tmdb_id,
      title: match.title ?? match.movie_title,
      releaseYear: match.release_year,
      posterUrl: match.poster_url ?? '',
      overview: match.overview ?? '',
      genres: [],
    });
  }, []);

  const { data: searchData, isFetching: isSearchFetching } = useSearchMovies(
    { q: debouncedQuery || '' },
    {
      query: {
        enabled: isSearching,
        queryKey: getSearchMoviesQueryKey({ q: debouncedQuery }),
      },
    }
  );
  const searchResults = searchData?.movies ?? [];

  const { data: lockerData } = useListMovies(
    { query: { queryKey: getListMoviesQueryKey(), enabled: Boolean(isSignedIn) } }
  );
  // Trending and New Releases are public; recommendations are not — they are
  // built from your own locker, so there is nothing to ask for without an
  // account. Disabled rather than left to 401 on every render.
  const { data: recommendationsData, isLoading: recommendationsLoading, refetch: refetchRecommendations, isRefetching: recommendationsRefetching } = useGetRecommendations(
    { region },
    { query: { queryKey: getGetRecommendationsQueryKey({ region }), enabled: Boolean(isSignedIn) } }
  );
  const { data: playlistsData, refetch: refetchPlaylists, isRefetching: playlistsRefetching } = useGetMyPlaylists({
    query: { queryKey: getGetMyPlaylistsQueryKey(), enabled: Boolean(isSignedIn) },
  });
  const { mutateAsync: createPlaylist, isPending: creating } = useCreatePlaylist();

  const trending = trendingData?.movies ?? [];
  const newReleases = newReleasesData?.movies ?? [];
  const recommendations = recommendationsData?.movies ?? [];
  const playlists = playlistsData?.playlists ?? [];
  const hasWatchlist = (lockerData?.movies.length ?? 0) > 0;

  /** TMDB ids already in the locker, so a recommendation can say so. */
  const savedTmdbIds = useMemo(
    () => new Set((lockerData?.movies ?? []).map((m) => m.tmdbId)),
    [lockerData]
  );
  const isRefreshing = trendingRefetching || newRefetching || recommendationsRefetching || playlistsRefetching;

  const savedVersion = selectedMovie
    ? lockerData?.movies.find((m) => m.tmdbId === selectedMovie.tmdbId)
    : undefined;

  // Avatar for the profile button. Clerk's own `imageUrl` is not consulted:
  // it carries whatever the social provider supplied, which for an account
  // with no photo is a generated picture of the first letter of the person's
  // name. Initials the user chose, else their username, else a person icon.
  const { data: profile } = useGetMe({ query: { queryKey: getGetMeQueryKey(), enabled: Boolean(isSignedIn) } });
  const displayInitials = profile?.displayInitials || profile?.username || null;

  const handleRefresh = useCallback(() => {
    refetchTrending();
    refetchNew();
    refetchRecommendations();
    if (isSignedIn) refetchPlaylists();
  }, [refetchTrending, refetchNew, refetchRecommendations, refetchPlaylists, isSignedIn]);

  const handleCreatePlaylist = useCallback(async (name: string, isPublic: boolean) => {
    try {
      const newPlaylist = await createPlaylist({ data: { name, isPublic } });
      await queryClient.invalidateQueries({ queryKey: getGetMyPlaylistsQueryKey() });
      setCreatePlaylistVisible(false);
      // Navigate to the new playlist immediately
      router.push({ pathname: '/playlist/[id]', params: { id: String((newPlaylist as any).id) } });
    } catch {
      Alert.alert('Error', 'Could not create playlist.');
    }
  }, [createPlaylist, queryClient, router]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#0066FF"
            colors={['#0066FF']}
          />
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.appTitle}>FILM LOCKER</Text>
            <Text style={styles.appSubtitle}>Discover your next favourite film</Text>
          </View>
          {/* Profile, or a way in for someone browsing without an account.
              There is no profile to open when signed out, so the same
              control offers sign-in rather than leading somewhere empty. */}
          {isSignedIn ? (
            <TouchableOpacity
              style={styles.profileBtn}
              onPress={() => router.push('/profile')}
              activeOpacity={0.8}
            >
              {displayInitials ? (
                <Text style={styles.profileInitials}>{displayInitials.slice(0, 5).toUpperCase()}</Text>
              ) : (
                <Ionicons name="person" size={18} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.signInBtn}
              onPress={() => router.push('/(auth)/sign-in')}
              activeOpacity={0.85}
            >
              <Text style={styles.signInBtnText}>Sign in</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* The same bar as the Watchlist, so a link, a screenshot and a
            recommendation request all work from wherever you happen to be. */}
        <FilmSearchBar
          tools={tools}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          placeholder="Search a film or paste a social link…"
        />

        {/* Results replace the browse sections while a search is running, so
            the answer is not buried under rows the user has stopped looking
            at. Clearing the box puts everything back. Recommendations take
            precedence over both, since asking for one is the most deliberate
            thing you can do on this screen. */}
        {tools.aiOpen ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {tools.isRecommending
                ? 'Thinking…'
                : tools.aiResults.length > 0
                  ? `Top ${tools.aiResults.length} recommendation${tools.aiResults.length === 1 ? '' : 's'}`
                  : 'Ask for a recommendation'}
            </Text>
            {tools.isRecommending ? (
              <ActivityIndicator color="#0066FF" style={{ marginTop: 16 }} />
            ) : tools.aiResults.length === 0 ? (
              <Text style={styles.searchEmpty}>
                Describe what you are after — “a 90 minute horror film similar to Texas Chainsaw”.
              </Text>
            ) : (
              // Mapped rather than a FlatList: this sits inside the page's
              // ScrollView, and six rows is nothing to virtualise.
              tools.aiResults.map((match, i) => (
                <AiResultRow
                  key={`ai-${match.tmdb_id ?? i}`}
                  match={match}
                  isSaved={match.tmdb_id != null && savedTmdbIds.has(match.tmdb_id)}
                  onPress={openAiResult}
                />
              ))
            )}
          </View>
        ) : isSearching ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {isSearchFetching
                ? 'Searching…'
                : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`}
            </Text>
            {!isSearchFetching && searchResults.length === 0 ? (
              <Text style={styles.searchEmpty}>No films found for “{debouncedQuery}”.</Text>
            ) : (
              <View style={styles.searchGrid}>
                {searchResults.map((m) => (
                  <TouchableOpacity
                    key={m.tmdbId}
                    style={styles.searchCard}
                    onPress={() => setSelectedMovie(m)}
                    activeOpacity={0.8}
                  >
                    <Image source={{ uri: m.posterUrl }} style={styles.searchPoster} contentFit="cover" />
                    <Text style={styles.searchTitle} numberOfLines={2}>{m.title}</Text>
                    <Text style={styles.searchYear}>{m.releaseYear}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        ) : (
        <>

        {/* Trending */}
        <View style={styles.section}>
          <SectionHeader title="🔥 Trending This Week" section="trending" />
          {trendingLoading ? (
            <SectionSkeleton />
          ) : (
            <FlatList
              data={trending}
              horizontal
              keyExtractor={(item) => `trend-${item.tmdbId}`}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              renderItem={({ item }) => (
                <View style={{ marginRight: 12 }}>
                  <DiscoverCard movie={item} onPress={setSelectedMovie} width={CARD_W} height={CARD_H} />
                </View>
              )}
            />
          )}
        </View>

        {/* New Releases */}
        <View style={styles.section}>
          <SectionHeader title="🎬 New Releases" section="new-releases" />
          {newReleasesLoading ? (
            <SectionSkeleton />
          ) : (
            <FlatList
              data={newReleases}
              horizontal
              keyExtractor={(item) => `new-${item.tmdbId}`}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              renderItem={({ item }) => (
                <View style={{ marginRight: 12 }}>
                  <DiscoverCard movie={item} onPress={setSelectedMovie} width={CARD_W} height={CARD_H} />
                </View>
              )}
            />
          )}
        </View>

        {/* Recommended for You */}
        {hasWatchlist && (
          <View style={styles.section}>
            <SectionHeader title="✨ Recommended for You" section="recommendations" />
            {recommendationsLoading ? (
              <SectionSkeleton />
            ) : recommendations.length === 0 ? null : (
              <FlatList
                data={recommendations}
                horizontal
                keyExtractor={(item) => `rec-${item.tmdbId}`}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
                renderItem={({ item }) => (
                  <View style={{ marginRight: 12 }}>
                    <DiscoverCard movie={item} onPress={setSelectedMovie} width={CARD_W} height={CARD_H} />
                  </View>
                )}
              />
            )}
          </View>
        )}

        {/* Playlists — only when signed in */}
        {isSignedIn && (
          <View style={styles.section}>
            <SectionHeader title="📋 Playlists" seeAllHref="/playlists" />
            {playlists.length === 0 ? (
              <TouchableOpacity
                style={styles.emptyPlaylistCard}
                onPress={() => setCreatePlaylistVisible(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="add-circle-outline" size={28} color="#0066FF" />
                <Text style={styles.emptyPlaylistText}>Create your first playlist</Text>
              </TouchableOpacity>
            ) : (
              <FlatList
                data={playlists}
                horizontal
                keyExtractor={(item) => `pl-${item.id}`}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.horizontalList, { paddingRight: 8 }]}
                renderItem={({ item }) => (
                  <PlaylistCard
                    playlist={item}
                    onPress={() => router.push({ pathname: '/playlist/[id]', params: { id: String(item.id) } })}
                  />
                )}
                ListFooterComponent={
                  <TouchableOpacity
                    style={styles.newPlaylistCard}
                    onPress={() => setCreatePlaylistVisible(true)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="add" size={28} color="#0066FF" />
                    <Text style={styles.newPlaylistText}>New</Text>
                  </TouchableOpacity>
                }
              />
            )}
          </View>
        )}
        </>
        )}

      </ScrollView>

      {/* Film detail modal */}
      {selectedMovie && (
        <FilmDetailModal
          visible={selectedMovie !== null}
          onClose={() => setSelectedMovie(null)}
          tmdbId={selectedMovie.tmdbId}
          title={selectedMovie.title}
          posterUrl={selectedMovie.posterUrl}
          releaseYear={selectedMovie.releaseYear}
          overview={selectedMovie.overview}
          savedMovie={savedVersion}
        />
      )}

      {/* Films identified from a pasted link or a photo, for confirmation —
          the same sheet the Watchlist and the share extension use. */}
      <ShareFilmSheet
        visible={showResultSheet}
        matches={resultMatches}
        listTitle={resultListTitle}
        onClose={() => {
          setShowResultSheet(false);
          setResultMatches([]);
          setResultListTitle(null);
        }}
        exitAppOnReturn={false}
      />

      {/* Create playlist modal */}
      <CreatePlaylistModal
        visible={createPlaylistVisible}
        onClose={() => setCreatePlaylistVisible(false)}
        onCreate={handleCreatePlaylist}
        creating={creating}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  appTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', letterSpacing: 3, color: '#111827' },
  appSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#6B7280', marginTop: 2 },
  searchEmpty: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#6B7280' },
  searchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  searchCard: { width: '30%' },
  searchPoster: { width: '100%', aspectRatio: 2 / 3, borderRadius: 8, backgroundColor: '#F3F4F6' },
  searchTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#111827', marginTop: 6 },
  searchYear: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginTop: 1 },
  signInBtn: {
    backgroundColor: '#0066FF', borderRadius: 18,
    paddingHorizontal: 16, paddingVertical: 9,
  },
  signInBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
  profileBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#0066FF', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  profileAvatar: { width: 36, height: 36, borderRadius: 18 },
  profileInitials: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFF' },

  section: { marginTop: 24 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, marginBottom: 12,
  },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#111827' },
  seeAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seeAllText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#0066FF' },
  horizontalList: { paddingHorizontal: 20 },

  emptyPlaylistCard: {
    marginHorizontal: 20, height: 100, borderRadius: 12,
    backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: '#93C5FD',
  },
  emptyPlaylistText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#0066FF' },

  newPlaylistCard: {
    width: 100, height: 100, borderRadius: 10,
    backgroundColor: '#F9FAFB', alignItems: 'center', justifyContent: 'center',
    gap: 4, borderWidth: 1, borderStyle: 'dashed', borderColor: '#D1D5DB',
  },
  newPlaylistText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: '#6B7280' },
});
