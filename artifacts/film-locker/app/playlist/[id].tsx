import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, Switch, Modal,
  Platform,
} from 'react-native';
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
  useListMovies,
  getGetPlaylistQueryKey,
  getGetMyPlaylistsQueryKey,
  type PlaylistItem,
  type Movie,
} from '@workspace/api-client-react';
import { MovieCard, MovieCardSkeleton } from '@/components/MovieCard';
import { FilmDetailModal } from '@/components/FilmDetailModal';
import { FilterBar, FilterState, applyFilters, type FilterableMovie } from '@/components/FilterBar';
import { confirmDestructive } from '@/lib/confirm';

function EditSheet({
  visible,
  initialName,
  initialDescription,
  initialIsPublic,
  onSave,
  onDelete,
  onClose,
  saving,
}: {
  visible: boolean;
  initialName: string;
  initialDescription: string | null | undefined;
  initialIsPublic: boolean;
  onSave: (data: { name: string; description: string | null; isPublic: boolean }) => void;
  onDelete: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [isPublic, setIsPublic] = useState(initialIsPublic);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={editStyles.overlay}>
        <TouchableOpacity style={editStyles.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={editStyles.sheet}>
          <View style={editStyles.handle} />
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

          <TouchableOpacity style={editStyles.deleteBtn} onPress={onDelete} activeOpacity={0.8}>
            <Ionicons name="trash-outline" size={16} color="#EF4444" style={{ marginRight: 6 }} />
            <Text style={editStyles.deleteBtnText}>Delete Playlist</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const editStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#111827', marginBottom: 20 },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#6B7280', marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, fontFamily: 'Inter_400Regular', color: '#111827',
    marginBottom: 16, backgroundColor: '#F9FAFB',
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
    confirmDestructive('Delete playlist', `Delete "${playlist?.name}"? This cannot be undone.`, 'Delete', async () => {
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
    confirmDestructive('Remove from Playlist', `Remove "${title}" from this playlist?`, 'Remove', async () => {
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
          initialName={playlist.name}
          initialDescription={playlist.description}
          initialIsPublic={playlist.isPublic}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditVisible(false)}
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
