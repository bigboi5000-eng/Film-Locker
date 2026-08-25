import React, { useState, useCallback, useMemo } from 'react';
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
  useListMovies,
  useGetMyPlaylists,
  useCreatePlaylist,
  useGetMe,
  getGetMyPlaylistsQueryKey,
  getGetMeQueryKey,
  type TmdbMovieCard,
} from '@workspace/api-client-react';
import { DiscoverCard } from '@/components/DiscoverCard';
import { FilmDetailModal } from '@/components/FilmDetailModal';
import { PlaylistCard } from '@/components/PlaylistCard';
import { CreatePlaylistModal } from '@/components/CreatePlaylistModal';
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
  actionLabel,
  onAction,
  onTitlePress,
}: {
  title: string;
  section?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Makes the title itself tappable — used for "Playlists" → the full Playlists hub. */
  onTitlePress?: () => void;
}) {
  const router = useRouter();
  return (
    <View style={styles.sectionHeader}>
      {onTitlePress ? (
        <TouchableOpacity onPress={onTitlePress} activeOpacity={0.7}>
          <Text style={styles.sectionTitle}>{title}</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.sectionTitle}>{title}</Text>
      )}
      {section ? (
        <TouchableOpacity
          style={styles.seeAllBtn}
          onPress={() => router.push(`/discover/${section}` as never)}
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

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();

  const [selectedMovie, setSelectedMovie] = useState<TmdbMovieCard | null>(null);
  const [createPlaylistVisible, setCreatePlaylistVisible] = useState(false);

  const region = useMemo(() => getDeviceRegion(), []);

  const { data: trendingData, isLoading: trendingLoading, refetch: refetchTrending, isRefetching: trendingRefetching } = useGetTrending({ region });
  const { data: newReleasesData, isLoading: newReleasesLoading, refetch: refetchNew, isRefetching: newRefetching } = useGetNewReleases({ region });
  const { data: lockerData } = useListMovies();
  const { data: recommendationsData, isLoading: recommendationsLoading, refetch: refetchRecommendations, isRefetching: recommendationsRefetching } = useGetRecommendations({ region });
  const { data: playlistsData, refetch: refetchPlaylists, isRefetching: playlistsRefetching } = useGetMyPlaylists({
    query: { queryKey: getGetMyPlaylistsQueryKey(), enabled: Boolean(isSignedIn) },
  });
  const { mutateAsync: createPlaylist, isPending: creating } = useCreatePlaylist();

  const trending = trendingData?.movies ?? [];
  const newReleases = newReleasesData?.movies ?? [];
  const recommendations = recommendationsData?.movies ?? [];
  const playlists = playlistsData?.playlists ?? [];
  const hasWatchlist = (lockerData?.movies.length ?? 0) > 0;
  const isRefreshing = trendingRefetching || newRefetching || recommendationsRefetching || playlistsRefetching;

  const savedVersion = selectedMovie
    ? lockerData?.movies.find((m) => m.tmdbId === selectedMovie.tmdbId)
    : undefined;

  // Avatar for profile button — a set displayInitials takes priority over
  // Clerk's own avatar image, so the button reflects what the user chose.
  const { data: profile } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const avatarUrl = user?.imageUrl;
  const displayInitials = profile?.displayInitials || null;

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
          {/* Profile button (was static blue circle) */}
          <TouchableOpacity
            style={styles.profileBtn}
            onPress={() => router.push('/profile')}
            activeOpacity={0.8}
          >
            {displayInitials ? (
              <Text style={styles.profileInitials}>{displayInitials}</Text>
            ) : avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.profileAvatar} contentFit="cover" />
            ) : (
              <Ionicons name="person" size={18} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        </View>

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
            <SectionHeader
              title="📋 Playlists"
              actionLabel="New"
              onAction={() => setCreatePlaylistVisible(true)}
              onTitlePress={() => router.push('/playlists')}
            />
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
