import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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

const CARD_W = 120;
const CARD_H = 180; // 2:3 ratio

function SectionSkeleton() {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
    >
      {[...Array(5)].map((_, i) => (
        <View
          key={i}
          style={{
            width: CARD_W,
            height: CARD_H,
            borderRadius: 10,
            backgroundColor: '#F3F4F6',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ActivityIndicator color="#D1D5DB" size="small" />
        </View>
      ))}
    </ScrollView>
  );
}

interface SectionHeaderProps {
  title: string;
  section: string;
}

function SectionHeader({ title, section }: SectionHeaderProps) {
  const router = useRouter();
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <TouchableOpacity
        style={styles.seeAllBtn}
        onPress={() => router.push(`/discover/${section}` as never)}
        activeOpacity={0.7}
        hitSlop={8}
      >
        <Text style={styles.seeAllText}>See All</Text>
        <Ionicons name="chevron-forward" size={13} color="#0066FF" />
      </TouchableOpacity>
    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [selectedMovie, setSelectedMovie] = useState<TmdbMovieCard | null>(null);

  const {
    data: trendingData,
    isLoading: trendingLoading,
    refetch: refetchTrending,
    isRefetching: trendingRefetching,
  } = useGetTrending();

  const {
    data: newReleasesData,
    isLoading: newReleasesLoading,
    refetch: refetchNew,
    isRefetching: newRefetching,
  } = useGetNewReleases();

  // Used to check if a discovered movie is already saved
  const { data: lockerData } = useListMovies();

  const hasWatchlist = (lockerData?.movies.length ?? 0) > 0;

  const {
    data: recommendationsData,
    isLoading: recommendationsLoading,
    refetch: refetchRecommendations,
    isRefetching: recommendationsRefetching,
  } = useGetRecommendations();

  const trending = trendingData?.movies ?? [];
  const newReleases = newReleasesData?.movies ?? [];
  const recommendations = recommendationsData?.movies ?? [];

  const isRefreshing = trendingRefetching || newRefetching || recommendationsRefetching;

  const handleRefresh = useCallback(() => {
    refetchTrending();
    refetchNew();
    refetchRecommendations();
  }, [refetchTrending, refetchNew, refetchRecommendations]);

  // Find the saved version of the selected movie (if it exists in the locker)
  const savedVersion = selectedMovie
    ? lockerData?.movies.find((m) => m.tmdbId === selectedMovie.tmdbId)
    : undefined;

  return (
    <View style={[styles.root, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
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
          <View style={styles.headerAccent} />
        </View>

        {/* Trending section */}
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
                  <DiscoverCard
                    movie={item}
                    onPress={setSelectedMovie}
                    width={CARD_W}
                    height={CARD_H}
                  />
                </View>
              )}
            />
          )}
        </View>

        {/* New Releases section */}
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
                  <DiscoverCard
                    movie={item}
                    onPress={setSelectedMovie}
                    width={CARD_W}
                    height={CARD_H}
                  />
                </View>
              )}
            />
          )}
        </View>

        {/* Recommended for You — only shown when the locker has films */}
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
                    <DiscoverCard
                      movie={item}
                      onPress={setSelectedMovie}
                      width={CARD_W}
                      height={CARD_H}
                    />
                  </View>
                )}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  appTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 3,
    color: '#111827',
  },
  appSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
    marginTop: 2,
  },
  headerAccent: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0066FF',
  },
  section: { marginTop: 24 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: '#111827',
  },
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seeAllText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#0066FF',
  },
  horizontalList: { paddingHorizontal: 20 },
});
