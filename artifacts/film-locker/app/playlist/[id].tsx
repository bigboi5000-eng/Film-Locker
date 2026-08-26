import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, Switch, Modal,
  Platform, KeyboardAvoidingView,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  useGetPlaylist,
  useUpdatePlaylist,
  useDeletePlaylist,
  useRemovePlaylistItem,
  useAddPlaylistItem,
  useSearchMovies,
  useListMovies,
  getGetPlaylistQueryKey,
  getGetMyPlaylistsQueryKey,
  getSearchMoviesQueryKey,
  type PlaylistItem,
  type Movie,
  type TmdbMovieCard,
} from '@workspace/api-client-react';
import { MovieCard, MovieCardSkeleton } from '@/components/MovieCard';
import { FilmDetailModal } from '@/components/FilmDetailModal';
import { FilterBar, FilterState, applyFilters, type FilterableMovie } from '@/components/FilterBar';
import { confirmDestructive } from '@/lib/confirm';
import { webInputReset } from '@/lib/webInputReset';

function AddFilmsSection({ playlistId, existingTmdbIds, onAdded }: {
  playlistId: number;
  existingTmdbIds: Set<number>;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [justAddedIds, setJustAddedIds] = useState<Set<number>>(new Set());
  const [addingId, setAddingId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isFetching } = useSearchMovies(
    { q: debouncedQuery },
    { query: { enabled: debouncedQuery.length >= 2, queryKey: getSearchMoviesQueryKey({ q: debouncedQuery }) } }
  );
  const { mutateAsync: addItem } = useAddPlaylistItem();
  const results = data?.movies ?? [];

  const handleAdd = useCallback(async (movie: TmdbMovieCard) => {
    setAddingId(movie.tmdbId);
    try {
      await addItem({
        id: playlistId,
        data: { tmdbId: movie.tmdbId, filmTitle: movie.title, posterUrl: movie.posterUrl ?? '' },
      });
      setJustAddedIds((prev) => new Set(prev).add(movie.tmdbId));
      onAdded();
    } catch {
      Alert.alert('Error', `Could not add "${movie.title}".`);
    } finally {
      setAddingId(null);
    }
  }, [addItem, playlistId, onAdded]);

  return (
    <View>
      <Text style={editStyles.label}>Add Films</Text>
      <View style={editStyles.searchRow}>
        <Ionicons name="search-outline" size={16} color="#9CA3AF" style={{ marginRight: 8 }} />
        <TextInput
          style={editStyles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search for a film to add…"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>

      {isFetching ? (
        <ActivityIndicator color="#0066FF" style={{ marginTop: 12 }} />
      ) : debouncedQuery.length >= 2 && results.length === 0 ? (
        <Text style={editStyles.searchEmptyText}>No films found for "{debouncedQuery}"</Text>
      ) : (
        results.map((movie) => {
          const alreadyIn = existingTmdbIds.has(movie.tmdbId) || justAddedIds.has(movie.tmdbId);
          return (
            <View key={movie.tmdbId} style={editStyles.filmRow}>
              {movie.posterUrl ? (
                <Image source={{ uri: movie.posterUrl }} style={editStyles.filmPoster} contentFit="cover" />
              ) : (
                <View style={[editStyles.filmPoster, editStyles.filmPosterFallback]}>
                  <Ionicons name="film-outline" size={16} color="#D1D5DB" />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={editStyles.filmTitle} numberOfLines={1}>{movie.title}</Text>
                {movie.releaseYear ? <Text style={editStyles.filmYear}>{movie.releaseYear}</Text> : null}
              </View>
              {alreadyIn ? (
                <View style={editStyles.addedRow}>
                  <Ionicons name="checkmark-circle" size={22} color="#16A34A" />
                </View>
              ) : addingId === movie.tmdbId ? (
                <ActivityIndicator color="#0066FF" size="small" />
              ) : (
                <TouchableOpacity onPress={() => handleAdd(movie)} hitSlop={8}>
                  <Ionicons name="add-circle-outline" size={26} color="#0066FF" />
                </TouchableOpacity>
              )}
            </View>
          );
        })
      )}
    </View>
  );
}

function EditSheet({
  visible,
  playlistId,
  initialName,
  initialDescription,
  initialIsPublic,
  existingTmdbIds,
  onSave,
  onDelete,
  onClose,
  onFilmAdded,
  saving,
}: {
  visible: boolean;
  playlistId: number;
  initialName: string;
  initialDescription: string | null | undefined;
  initialIsPublic: boolean;
  existingTmdbIds: Set<number>;
  onSave: (data: { name: string; description: string | null; isPublic: boolean }) => void;
  onDelete: () => void;
  onClose: () => void;
  onFilmAdded: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [isPublic, setIsPublic] = useState(initialIsPublic);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* KeyboardAvoidingView wraps the whole overlay (not just an inner
          ScrollView) so the sheet itself shrinks/moves above the keyboard —
          a bottom-anchored sheet's ScrollView scrolling its own content
          isn't enough on its own, since the sheet's position is otherwise
          independent of keyboard state. */}
      <KeyboardAvoidingView style={editStyles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity style={editStyles.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={editStyles.sheet}>
          <View style={editStyles.handle} />
          <ScrollView contentContainerStyle={editStyles.scrollContent} keyboardShouldPersistTaps="handled">
            <Text style={editStyles.title}>Edit Playlist</Text>

            <Text style={editStyles.label}>Name</Text>
            <TextInput
              style={editStyles.input}
              value={name}
              onChangeText={setName}
              placeholder="Playlist name"
              placeholderTextColor="#9CA3AF"
              maxLength={100}
            />

            <Text style={editStyles.label}>Description</Text>
            <TextInput
              style={[editStyles.input, editStyles.inputMultiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="Optional description…"
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={3}
              maxLength={300}
            />

            <View style={editStyles.toggleRow}>
              <View>
                <Text style={editStyles.toggleLabel}>Public playlist</Text>
                <Text style={editStyles.toggleSub}>Anyone can search for and view this</Text>
              </View>
              <Switch
                value={isPublic}
                onValueChange={setIsPublic}
                trackColor={{ true: '#0066FF', false: '#E5E7EB' }}
                thumbColor="#FFF"
              />
            </View>

            <TouchableOpacity
              style={editStyles.saveBtn}
              onPress={() => onSave({ name: name.trim(), description: description.trim() || null, isPublic })}
              disabled={saving || !name.trim()}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={editStyles.saveBtnText}>Save Changes</Text>
              )}
            </TouchableOpacity>

            <View style={editStyles.divider} />

            <AddFilmsSection playlistId={playlistId} existingTmdbIds={existingTmdbIds} onAdded={onFilmAdded} />

            <View style={editStyles.divider} />

            <TouchableOpacity style={editStyles.deleteBtn} onPress={onDelete} activeOpacity={0.8}>
              <Ionicons name="trash-outline" size={16} color="#EF4444" style={{ marginRight: 6 }} />
              <Text style={editStyles.deleteBtnText}>Delete Playlist</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const editStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%', paddingTop: 12 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 16 },
  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 20 },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#111827', marginBottom: 20 },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#6B7280', marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, fontFamily: 'Inter_400Regular', color: '#111827',
    marginBottom: 16, backgroundColor: '#F9FAFB',
    ...webInputReset,
  },
  inputMultiline: { height: 80, textAlignVertical: 'top' },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6', marginBottom: 20,
  },
  toggleLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#111827' },
  toggleSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginTop: 2 },
  saveBtn: { backgroundColor: '#0066FF', padding: 14, borderRadius: 10, alignItems: 'center', marginBottom: 12 },
  saveBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    padding: 14, borderRadius: 10, backgroundColor: '#FEF2F2',
  },
  deleteBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#EF4444' },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 4,
    backgroundColor: '#F9FAFB', borderRadius: 10,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  searchInput: {
    flex: 1, paddingVertical: 10,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: '#111827',
    ...webInputReset,
  },
  searchEmptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginTop: 12 },
  filmRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, marginTop: 4,
  },
  filmPoster: { width: 34, height: 50, borderRadius: 6 },
  filmPosterFallback: { backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  filmTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#111827' },
  filmYear: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },
  addedRow: { flexDirection: 'row', alignItems: 'center' },
});

// ─────────────────────────────────────────────────────────────────────────────

interface ModalTarget {
  tmdbId: number;
  title: string;
  posterUrl: string;
  releaseYear: string;
  overview: string;
  savedMovie?: Movie;
}

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const numericId = Number(id);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [editVisible, setEditVisible] = useState(false);
  const [filters, setFilters] = useState<FilterState>({});
  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);

  const { data: playlist, isLoading } = useGetPlaylist(numericId, {
    query: { queryKey: getGetPlaylistQueryKey(numericId), enabled: !isNaN(numericId) },
  });

  const { mutateAsync: updatePlaylist, isPending: saving } = useUpdatePlaylist();
  const { mutateAsync: deletePlaylist } = useDeletePlaylist();
  const { mutateAsync: removeItem } = useRemovePlaylistItem();

  // Playlist items only store tmdbId/title/poster (see playlist_items schema) —
  // no genre/director/cast/language/watch-provider data to filter on. Enrich
  // from the user's watchlist when the same film is saved there too, so
  // filtering works the same way it does on the other tabs for anything
  // that's been through the TMDB enrichment pipeline.
  const { data: moviesData } = useListMovies();
  const savedByTmdbId = useMemo(
    () => new Map((moviesData?.movies ?? []).map((m) => [m.tmdbId, m])),
    [moviesData]
  );

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: getGetPlaylistQueryKey(numericId) });
    await queryClient.invalidateQueries({ queryKey: getGetMyPlaylistsQueryKey() });
  }, [queryClient, numericId]);

  const handleSave = useCallback(async (data: { name: string; description: string | null; isPublic: boolean }) => {
    try {
      await updatePlaylist({ id: numericId, data });
      await invalidate();
      setEditVisible(false);
    } catch {
      Alert.alert('Error', 'Could not update playlist.');
    }
  }, [updatePlaylist, numericId, invalidate]);

  const handleDelete = useCallback(() => {
    confirmDestructive(`Would you like to delete "${playlist?.name}"? This cannot be undone.`, 'Delete', async () => {
      try {
        await deletePlaylist({ id: numericId });
        await queryClient.invalidateQueries({ queryKey: getGetMyPlaylistsQueryKey() });
        router.back();
      } catch {
        Alert.alert('Error', 'Could not delete playlist.');
      }
    });
  }, [deletePlaylist, numericId, playlist?.name, queryClient, router]);

  const handleRemove = useCallback((tmdbId: number, title: string) => {
    confirmDestructive(`Would you like to remove "${title}" from this playlist?`, 'Remove', async () => {
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      try {
        await removeItem({ id: numericId, tmdbId });
        await invalidate();
      } catch {
        Alert.alert('Error', `Could not remove "${title}".`);
      }
    });
  }, [removeItem, numericId, invalidate]);

  const openItemModal = useCallback((item: PlaylistItem) => {
    const saved = savedByTmdbId.get(item.tmdbId);
    setModalTarget({
      tmdbId: item.tmdbId,
      title: item.filmTitle,
      posterUrl: item.posterUrl,
      releaseYear: saved?.releaseYear ?? '',
      overview: saved?.overview ?? '',
      savedMovie: saved,
    });
  }, [savedByTmdbId]);

  const renderItem = useCallback(({ item }: { item: PlaylistItem }) => (
    <MovieCard
      id={item.tmdbId}
      title={item.filmTitle}
      releaseYear={savedByTmdbId.get(item.tmdbId)?.releaseYear ?? ''}
      posterUrl={item.posterUrl}
      onPress={() => openItemModal(item)}
      onLongPress={() => handleRemove(item.tmdbId, item.filmTitle)}
    />
  ), [savedByTmdbId, openItemModal, handleRemove]);

  const items = playlist?.items ?? [];
  const existingTmdbIds = useMemo(() => new Set(items.map((item) => item.tmdbId)), [items]);

  // Merge in filterable metadata from the matching watchlist entry, if any.
  const filterableItems = useMemo(
    () => items.map((item) => {
      const saved = savedByTmdbId.get(item.tmdbId);
      return {
        ...item,
        genres: saved?.genres,
        director: saved?.director,
        cast: saved?.cast,
        language: saved?.language,
        watchProviders: saved?.watchProviders,
      };
    }),
    [items, savedByTmdbId]
  );
  const filteredItems = useMemo(
    () => applyFilters(filterableItems, filters),
    [filterableItems, filters]
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color="#111827" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          {isLoading ? (
            <ActivityIndicator color="#0066FF" />
          ) : (
            <>
              <Text style={styles.headerTitle} numberOfLines={1}>{playlist?.name ?? 'Playlist'}</Text>
              <View style={styles.headerMeta}>
                <Ionicons
                  name={playlist?.isPublic ? 'globe-outline' : 'lock-closed-outline'}
                  size={12}
                  color="#9CA3AF"
                />
                <Text style={styles.headerMetaText}>
                  {playlist?.isPublic ? 'Public' : 'Private'} · {items.length} film{items.length !== 1 ? 's' : ''}
                </Text>
              </View>
            </>
          )}
        </View>
        <TouchableOpacity onPress={() => setEditVisible(true)} style={styles.editBtn} activeOpacity={0.7}>
          <Ionicons name="pencil-outline" size={20} color="#6B7280" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.skeletonGrid}>
          {[...Array(6)].map((_, i) => (
            <MovieCardSkeleton key={i} />
          ))}
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="film-outline" size={56} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>Empty playlist</Text>
          <Text style={styles.emptySub}>
            Add films from the watchlist or film detail screens.
          </Text>
        </View>
      ) : (
        <>
          <FilterBar movies={filterableItems} filters={filters} onChange={setFilters} />

          {filteredItems.length > 0 && (
            <View style={styles.sectionLabelRow}>
              <Text style={styles.sectionLabel}>
                {filteredItems.length} FILM{filteredItems.length === 1 ? '' : 'S'}
              </Text>
              <Text style={styles.sectionHint}>Hold to remove</Text>
            </View>
          )}

          <FlatList
            data={filteredItems}
            numColumns={2}
            keyExtractor={(item) => String(item.tmdbId)}
            renderItem={renderItem}
            columnWrapperStyle={styles.columnWrapper}
            contentContainerStyle={[styles.contentContainer, { paddingBottom: insets.bottom + 16 }]}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="film-outline" size={56} color="#D1D5DB" />
                <Text style={styles.emptyTitle}>No films match your filters</Text>
                <Text style={styles.emptySub}>Try clearing your filters</Text>
              </View>
            }
          />
        </>
      )}

      {playlist && (
        <EditSheet
          visible={editVisible}
          playlistId={numericId}
          initialName={playlist.name}
          initialDescription={playlist.description}
          initialIsPublic={playlist.isPublic}
          existingTmdbIds={existingTmdbIds}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditVisible(false)}
          onFilmAdded={invalidate}
          saving={saving}
        />
      )}

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
    </View>
  );
}

const HORIZONTAL_PADDING = 16;
const COLUMN_GAP = 10;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  backBtn: { padding: 4 },
  headerCenter: { flex: 1, marginHorizontal: 12 },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#111827' },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  headerMetaText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },
  editBtn: { padding: 8 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: '#374151' },
  emptySub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },

  contentContainer: { paddingHorizontal: HORIZONTAL_PADDING },
  columnWrapper: { gap: COLUMN_GAP, marginBottom: COLUMN_GAP },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: HORIZONTAL_PADDING,
    gap: COLUMN_GAP,
  },

  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 4,
    paddingBottom: 10,
  },
  sectionLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#9CA3AF', letterSpacing: 1.5 },
  sectionHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },
});
