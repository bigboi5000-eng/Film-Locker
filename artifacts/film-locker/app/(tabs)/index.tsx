import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Platform,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import {
  useGetTrending,
  useGetNewReleases,
  useListMovies,
  type TmdbMovieCard,
} from '@workspace/api-client-react';
import { FilmDetailModal } from '@/components/FilmDetailModal';

const { width: W } = Dimensions.get('window');
const CARD_W = 120;
const CARD_H = 180; // 2:3 ratio

interface DiscoverCardProps {
  movie: TmdbMovieCard;
  onPress: (movie: TmdbMovieCard) => void;
}

function DiscoverCard({ movie, onPress }: DiscoverCardProps) {
  return (
    <TouchableOpacity
      style={discoverStyles.card}
      onPress={() => onPress(movie)}
      activeOpacity={0.85}
    >
      <Image
        source={{ uri: movie.posterUrl }}
        style={discoverStyles.poster}
        contentFit="cover"
        transition={250}
        placeholder={require('@/assets/images/icon.png')}
      />
      <View style={discoverStyles.overlay}>
        <Text style={discoverStyles.title} numberOfLines={2}>{movie.title}</Text>
        {movie.releaseYear ? (
          <Text style={discoverStyles.year}>{movie.releaseYear}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const discoverStyles = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
    marginRight: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  poster: { width: '100%', height: '100%' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  title: { color: '#FFFFFF', fontSize: 11, fontFamily: 'Inter_600SemiBold', lineHeight: 15 },
  year: { color: '#FF8C00', fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 2 },
});

function SectionSkeleton() {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
      {[...Array(5)].map((_, i) => (
        <View key={i} style={[discoverStyles.card, { backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator color="#D1D5DB" size="small" />
        </View>
      ))}
    </ScrollView>
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
  const savedTmdbIds = new Set(lockerData?.movies.map((m) => m.tmdbId) ?? []);

  const trending = trendingData?.movies ?? [];
  const newReleases = newReleasesData?.movies ?? [];

  const isRefreshing = trendingRefetching || newRefetching;

  const handleRefresh = useCallback(() => {
    refetchTrending();
    refetchNew();
  }, [refetchTrending, refetchNew]);

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
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>🔥 Trending This Week</Text>
          </View>
          {trendingLoading ? (
            <SectionSkeleton />
          ) : (
            <FlatList
              data={trending}
              horizontal
              keyExtractor={(item) => String(item.tmdbId)}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              renderItem={({ item }) => (
                <DiscoverCard movie={item} onPress={setSelectedMovie} />
              )}
            />
          )}
        </View>

        {/* New Releases section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>🎬 New Releases</Text>
          </View>
          {newReleasesLoading ? (
            <SectionSkeleton />
          ) : (
            <FlatList
              data={newReleases}
              horizontal
              keyExtractor={(item) => String(item.tmdbId)}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              renderItem={({ item }) => (
                <DiscoverCard movie={item} onPress={setSelectedMovie} />
              )}
            />
          )}
        </View>
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
  horizontalList: { paddingHorizontal: 20 },
});
