import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { webInputReset } from '@/lib/webInputReset';
import { PlaylistCard } from '@/components/PlaylistCard';
import { CreatePlaylistModal } from '@/components/CreatePlaylistModal';
import {
  useGetMyPlaylists,
  useCreatePlaylist,
  useSearchPublicPlaylists,
  useSearchMovies,
  getGetMyPlaylistsQueryKey,
  getSearchPublicPlaylistsQueryKey,
  getSearchMoviesQueryKey,
  type Playlist,
  type TmdbMovieCard,
} from '@workspace/api-client-react';

type Tab = 'mine' | 'discover';
type DiscoverMode = 'name' | 'film';

export default function PlaylistsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>('mine');
  const [createVisible, setCreateVisible] = useState(false);

  // ── Mine ────────────────────────────────────────────────────────────────
  const { data: myData, isLoading: myLoading } = useGetMyPlaylists({
    query: { queryKey: getGetMyPlaylistsQueryKey() },
  });
  const { mutateAsync: createPlaylist, isPending: creating } = useCreatePlaylist();
  const myPlaylists = myData?.playlists ?? [];

  const handleCreatePlaylist = useCallback(async (name: string, isPublic: boolean) => {
    try {
      const newPlaylist = await createPlaylist({ data: { name, isPublic } });
      await queryClient.invalidateQueries({ queryKey: getGetMyPlaylistsQueryKey() });
      setCreateVisible(false);
      router.push({ pathname: '/playlist/[id]', params: { id: String((newPlaylist as Playlist).id) } });
    } catch {
      Alert.alert('Error', 'Could not create playlist.');
    }
  }, [createPlaylist, queryClient, router]);

  // ── Discover ────────────────────────────────────────────────────────────
  const [discoverMode, setDiscoverMode] = useState<DiscoverMode>('name');
  const [nameQuery, setNameQuery] = useState('');
  const [debouncedName, setDebouncedName] = useState('');
  const [filmQuery, setFilmQuery] = useState('');
  const [debouncedFilm, setDebouncedFilm] = useState('');
  const [selectedFilm, setSelectedFilm] = useState<TmdbMovieCard | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedName(nameQuery.trim()), 400);
    return () => clearTimeout(t);
  }, [nameQuery]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilm(filmQuery.trim()), 400);
    return () => clearTimeout(t);
  }, [filmQuery]);

  const { data: filmResultsData, isFetching: filmResultsLoading } = useSearchMovies(
    { q: debouncedFilm },
    { query: { enabled: discoverMode === 'film' && !selectedFilm && debouncedFilm.length >= 2, queryKey: getSearchMoviesQueryKey({ q: debouncedFilm }) } }
  );
  const filmResults = filmResultsData?.movies ?? [];

  const searchParams =
    discoverMode === 'name'
      ? { q: debouncedName }
      : selectedFilm
        ? { tmdbId: selectedFilm.tmdbId }
        : undefined;

  const { data: publicData, isLoading: publicLoading } = useSearchPublicPlaylists(searchParams, {
    query: {
      enabled: discoverMode === 'name' ? debouncedName.length >= 2 : Boolean(selectedFilm),
      queryKey: getSearchPublicPlaylistsQueryKey(searchParams),
    },
  });
  const publicPlaylists = publicData?.playlists ?? [];

  const handlePickFilm = useCallback((movie: TmdbMovieCard) => {
    setSelectedFilm(movie);
    setFilmQuery(movie.title);
  }, []);

  const handleClearFilm = useCallback(() => {
    setSelectedFilm(null);
    setFilmQuery('');
    setDebouncedFilm('');
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Playlists</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'mine' && styles.tabBtnActive]}
          onPress={() => setTab('mine')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabBtnText, tab === 'mine' && styles.tabBtnTextActive]}>Mine</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'discover' && styles.tabBtnActive]}
          onPress={() => setTab('discover')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabBtnText, tab === 'discover' && styles.tabBtnTextActive]}>Discover</Text>
        </TouchableOpacity>
      </View>

      {tab === 'mine' ? (
        myLoading ? (
          <ActivityIndicator color="#0066FF" style={{ marginTop: 32 }} />
        ) : (
          <FlatList
            data={myPlaylists}
            numColumns={2}
            keyExtractor={(item) => `pl-${item.id}`}
            columnWrapperStyle={{ paddingHorizontal: 16, justifyContent: 'space-between' }}
            contentContainerStyle={{ paddingTop: 16, paddingBottom: insets.bottom + 24, gap: 16 }}
            ListEmptyComponent={
              <TouchableOpacity style={styles.emptyCard} onPress={() => setCreateVisible(true)} activeOpacity={0.8}>
                <Ionicons name="add-circle-outline" size={28} color="#0066FF" />
                <Text style={styles.emptyCardText}>Create your first playlist</Text>
              </TouchableOpacity>
            }
            renderItem={({ item }) => (
              <PlaylistCard
                playlist={item}
                onPress={() => router.push({ pathname: '/playlist/[id]', params: { id: String(item.id) } })}
              />
            )}
          />
        )
      ) : (
        <View style={{ flex: 1 }}>
          {/* Search mode toggle */}
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, discoverMode === 'name' && styles.modeBtnActive]}
              onPress={() => setDiscoverMode('name')}
              activeOpacity={0.8}
            >
              <Text style={[styles.modeBtnText, discoverMode === 'name' && styles.modeBtnTextActive]}>By Name</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, discoverMode === 'film' && styles.modeBtnActive]}
              onPress={() => setDiscoverMode('film')}
              activeOpacity={0.8}
            >
              <Text style={[styles.modeBtnText, discoverMode === 'film' && styles.modeBtnTextActive]}>By Film</Text>
            </TouchableOpacity>
          </View>

          {discoverMode === 'name' ? (
            <View style={styles.searchRow}>
              <Ionicons name="search-outline" size={18} color="#9CA3AF" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                value={nameQuery}
                onChangeText={setNameQuery}
                placeholder="Search public playlists by name…"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                returnKeyType="search"
              />
              {nameQuery.length > 0 && (
                <TouchableOpacity onPress={() => setNameQuery('')} style={styles.clearBtn}>
                  <Ionicons name="close-circle" size={18} color="#9CA3AF" />
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.searchRow}>
              <Ionicons name="film-outline" size={18} color="#9CA3AF" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                value={filmQuery}
                onChangeText={(t) => { setFilmQuery(t); setSelectedFilm(null); }}
                placeholder="Search for a film…"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                returnKeyType="search"
              />
              {filmQuery.length > 0 && (
                <TouchableOpacity onPress={handleClearFilm} style={styles.clearBtn}>
                  <Ionicons name="close-circle" size={18} color="#9CA3AF" />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Film picker dropdown */}
          {discoverMode === 'film' && !selectedFilm && debouncedFilm.length >= 2 && (
            filmResultsLoading ? (
              <ActivityIndicator color="#0066FF" style={{ marginTop: 12 }} />
            ) : filmResults.length === 0 ? (
              <Text style={styles.emptyText}>No films found for "{debouncedFilm}"</Text>
            ) : (
              <FlatList
                data={filmResults}
                keyExtractor={(item) => `film-${item.tmdbId}`}
                style={{ maxHeight: 260 }}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.filmRow} onPress={() => handlePickFilm(item)} activeOpacity={0.75}>
                    {item.posterUrl ? (
                      <Image source={{ uri: item.posterUrl }} style={styles.filmPoster} contentFit="cover" />
                    ) : (
                      <View style={[styles.filmPoster, styles.filmPosterFallback]}>
                        <Ionicons name="film-outline" size={16} color="#D1D5DB" />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.filmTitle} numberOfLines={1}>{item.title}</Text>
                      {item.releaseYear ? <Text style={styles.filmYear}>{item.releaseYear}</Text> : null}
                    </View>
                  </TouchableOpacity>
                )}
              />
            )
          )}

          {/* Results */}
          {(discoverMode === 'name' ? debouncedName.length >= 2 : Boolean(selectedFilm)) && (
            publicLoading ? (
              <ActivityIndicator color="#0066FF" style={{ marginTop: 16 }} />
            ) : publicPlaylists.length === 0 ? (
              <Text style={styles.emptyText}>No public playlists found.</Text>
            ) : (
              <FlatList
                data={publicPlaylists}
                numColumns={2}
                keyExtractor={(item) => `pub-${item.id}`}
                columnWrapperStyle={{ paddingHorizontal: 16, justifyContent: 'space-between' }}
                contentContainerStyle={{ paddingTop: 16, paddingBottom: insets.bottom + 24, gap: 16 }}
                renderItem={({ item }) => (
                  <PlaylistCard
                    playlist={item}
                    onPress={() => router.push({ pathname: '/playlist/[id]', params: { id: String(item.id) } })}
                  />
                )}
              />
            )
          )}
        </View>
      )}

      {tab === 'mine' && (
        <TouchableOpacity style={styles.fab} onPress={() => setCreateVisible(true)} activeOpacity={0.85}>
          <Ionicons name="add" size={26} color="#FFF" />
        </TouchableOpacity>
      )}

      <CreatePlaylistModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreate={handleCreatePlaylist}
        creating={creating}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  backBtn: { padding: 4, marginRight: 12 },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#111827' },

  tabRow: {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 14,
    backgroundColor: '#F3F4F6', borderRadius: 10, padding: 3,
  },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#FFFFFF' },
  tabBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#9CA3AF' },
  tabBtnTextActive: { color: '#111827' },

  modeRow: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 16 },
  modeBtn: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16,
    backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB',
  },
  modeBtnActive: { backgroundColor: '#EFF6FF', borderColor: '#93C5FD' },
  modeBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#6B7280' },
  modeBtnTextActive: { color: '#0066FF' },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginTop: 12, paddingHorizontal: 12,
    backgroundColor: '#F9FAFB', borderRadius: 10,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1, paddingVertical: 12,
    fontSize: 15, fontFamily: 'Inter_400Regular', color: '#111827',
    ...webInputReset,
  },
  clearBtn: { padding: 4 },

  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginTop: 16, marginHorizontal: 16 },

  filmRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  filmPoster: { width: 34, height: 50, borderRadius: 6 },
  filmPosterFallback: { backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  filmTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#111827' },
  filmYear: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },

  emptyCard: {
    marginHorizontal: 16, height: 100, borderRadius: 12,
    backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: '#93C5FD',
  },
  emptyCardText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#0066FF' },

  fab: {
    position: 'absolute', right: 20, bottom: 28,
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#0066FF', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
});
