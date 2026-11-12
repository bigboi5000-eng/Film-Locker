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
import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  useGetPlaylist,
  useUpdatePlaylist,
  useDeletePlaylist,
  useRemovePlaylistItem,
  useAddPlaylistItem,
  useFollowPlaylist,
  useUnfollowPlaylist,
  useSearchMovies,
  useListMovies,
  getGetPlaylistQueryKey,
  getGetMyPlaylistsQueryKey,
  getGetFollowedPlaylistsQueryKey,
  getSearchMoviesQueryKey,
  type PlaylistItem,
  type Movie,
  type TmdbMovieCard,
} from '@workspace/api-client-react';
import { MovieCard, MovieCardSkeleton, type MovieCardBadge } from '@/components/MovieCard';
import { GridTopCaps } from '@/components/GridTopCaps';
import { LoadError } from '@/components/LoadError';
import { useWatchedTmdbIds } from '@/hooks/useWatchedTmdbIds';
import { FilmDetailModal } from '@/components/FilmDetailModal';
import { FilterBar, FilterState, applyFilters, type FilterableMovie } from '@/components/FilterBar';
import { SharePlaylistSheet } from '@/components/SharePlaylistSheet';
import { CollaboratorsSheet } from '@/components/CollaboratorsSheet';
import { collaboratorColorMap, badgeInitials } from '@/lib/collaboratorColors';
import { applySort, type SortState } from '@/components/SortSheet';
import { confirmDestructive } from '@/lib/confirm';
import { webInputReset } from '@/lib/webInputReset';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

function AddFilmsSection({ playlistId, existingTmdbIds, onAdded }: {
  playlistId: number;
  existingTmdbIds: Set<number>;
  onAdded: () => void;
}) {
  const colors = useColors();
  const editStyles = useThemedStyles(makeEditStyles);
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
        <Ionicons name="search-outline" size={16} color={colors.textFaint} style={{ marginRight: 8 }} />
        <TextInput
          style={editStyles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search for a film to add…"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textFaint} />
          </TouchableOpacity>
        )}
      </View>

      {isFetching ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
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
                  <Ionicons name="film-outline" size={16} color={colors.iconFaint} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={editStyles.filmTitle} numberOfLines={1}>{movie.title}</Text>
                {movie.releaseYear ? <Text style={editStyles.filmYear}>{movie.releaseYear}</Text> : null}
              </View>
              {alreadyIn ? (
                <View style={editStyles.addedRow}>
                  <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                </View>
              ) : addingId === movie.tmdbId ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <TouchableOpacity onPress={() => handleAdd(movie)} hitSlop={8}>
                  <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
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
  const colors = useColors();
  const editStyles = useThemedStyles(makeEditStyles);
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
              placeholderTextColor={colors.textFaint}
              maxLength={100}
            />

            <Text style={editStyles.label}>Description</Text>
            <TextInput
              style={[editStyles.input, editStyles.inputMultiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="Optional description…"
              placeholderTextColor={colors.textFaint}
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
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor={colors.background}
              />
            </View>

            <TouchableOpacity
              style={editStyles.saveBtn}
              onPress={() => onSave({ name: name.trim(), description: description.trim() || null, isPublic })}
              disabled={saving || !name.trim()}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator color={colors.onColor} />
              ) : (
                <Text style={editStyles.saveBtnText}>Save Changes</Text>
              )}
            </TouchableOpacity>

            <View style={editStyles.divider} />

            <AddFilmsSection playlistId={playlistId} existingTmdbIds={existingTmdbIds} onAdded={onFilmAdded} />

            <View style={editStyles.divider} />

            <TouchableOpacity style={editStyles.deleteBtn} onPress={onDelete} activeOpacity={0.8}>
              <Ionicons name="trash-outline" size={16} color={colors.destructive} style={{ marginRight: 6 }} />
              <Text style={editStyles.deleteBtnText}>Delete Playlist</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeEditStyles = (c: Palette) => StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: c.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%', paddingTop: 12 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: 16 },
  divider: { height: 1, backgroundColor: c.surfaceAlt, marginVertical: 20 },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: c.text, marginBottom: 20 },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.textMuted, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: c.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, fontFamily: 'Inter_400Regular', color: c.text,
    marginBottom: 16, backgroundColor: c.surfaceSubtle,
    ...webInputReset,
  },
  inputMultiline: { height: 80, textAlignVertical: 'top' },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.surfaceAlt, marginBottom: 20,
  },
  toggleLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: c.text },
  toggleSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textFaint, marginTop: 2 },
  saveBtn: { backgroundColor: c.primary, padding: 14, borderRadius: 10, alignItems: 'center', marginBottom: 12 },
  saveBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: c.onColor },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    padding: 14, borderRadius: 10, backgroundColor: c.destructiveSoft,
  },
  deleteBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: c.destructive },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 4,
    backgroundColor: c.surfaceSubtle, borderRadius: 10,
    borderWidth: 1, borderColor: c.border,
  },
  searchInput: {
    flex: 1, paddingVertical: 10,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: c.text,
    ...webInputReset,
  },
  searchEmptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: c.textFaint, marginTop: 12 },
  filmRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, marginTop: 4,
  },
  filmPoster: { width: 34, height: 50, borderRadius: 6 },
  filmPosterFallback: { backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  filmTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: c.text },
  filmYear: { fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textFaint },
  addedRow: { flexDirection: 'row', alignItems: 'center' },
});

/**
 * Adding films, for somebody who is not the owner.
 *
 * The owner adds films from inside the edit sheet, next to the name and the
 * privacy switch, because for them it is all one screen of "this is my
 * list". A collaborator has none of that — they cannot rename it, cannot
 * make it public and cannot delete it — so handing them the edit sheet
 * would be a sheet of controls that mostly do not apply to them.
 */
function AddFilmsSheet({ visible, onClose, playlistId, playlistName, existingTmdbIds, onFilmAdded }: {
  visible: boolean;
  onClose: () => void;
  playlistId: number;
  playlistName: string;
  existingTmdbIds: Set<number>;
  onFilmAdded: () => void;
}) {
  const editStyles = useThemedStyles(makeEditStyles);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={editStyles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity style={editStyles.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={editStyles.sheet}>
          <View style={editStyles.handle} />
          <ScrollView contentContainerStyle={editStyles.scrollContent} keyboardShouldPersistTaps="handled">
            <Text style={editStyles.title}>Add to {playlistName}</Text>
            <AddFilmsSection
              playlistId={playlistId}
              existingTmdbIds={existingTmdbIds}
              onAdded={onFilmAdded}
            />
            <TouchableOpacity style={editStyles.saveBtn} onPress={onClose} activeOpacity={0.8}>
              <Text style={editStyles.saveBtnText}>Done</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface ModalTarget {
  tmdbId: number;
  title: string;
  posterUrl: string;
  releaseYear: string;
  overview: string;
  savedMovie?: Movie;
  sourceUrl?: string | null;
}

export default function PlaylistScreen() {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const numericId = Number(id);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [editVisible, setEditVisible] = useState(false);
  const [filters, setFilters] = useState<FilterState>({});
  /**
   * A playlist arrives in the order its owner built it, which is a decision
   * rather than an accident — so that is where this rests, and sorting is
   * something you opt into.
   */
  const [sort, setSort] = useState<SortState>({ key: 'none', direction: 'desc' });
  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);

  const watchedTmdbIds = useWatchedTmdbIds();
  const { data: playlist, isLoading, isError, error, refetch, isRefetching } = useGetPlaylist(numericId, {
    query: { queryKey: getGetPlaylistQueryKey(numericId), enabled: !isNaN(numericId) },
  });

  // Everything that changes a playlist is owner-only. The server already
  // enforces this — POST/DELETE of items and the playlist itself all 403 for
  // anyone else — so this is about not offering controls that cannot work:
  // a public playlist showed a stranger an edit button and "Hold to remove",
  // both of which would only ever produce an error.
  const { userId: myClerkId } = useAuth();
  // Trust the server's own verdict where it has one; fall back to comparing
  // ids while the response is still loading.
  const isOwner = playlist?.isOwner ?? Boolean(playlist && myClerkId && playlist.userId === myClerkId);
  const [shareVisible, setShareVisible] = useState(false);
  const [collabVisible, setCollabVisible] = useState(false);
  const [addVisible, setAddVisible] = useState(false);

  /**
   * Adding and removing films, which is wider than ownership now: a
   * collaborator does both. Everything else on this screen — the pencil,
   * the send button, deleting, inviting — stays on isOwner, and the server
   * enforces the same split.
   *
   * The fallback keeps an owner's controls working while the response is
   * still in flight; a collaborator has no way to know before it arrives,
   * and showing them a disabled list for a moment is better than showing
   * everyone "Hold to remove" and finding out later.
   */
  const canEdit = playlist?.canEdit ?? isOwner;

  // Present only on a list that has collaborators. The sheet asks the
  // server for both itself, so the cap is never a number kept here.
  const collaborators = playlist?.collaborators ?? [];
  const maxCollaborators = playlist?.maxCollaborators;

  /**
   * clerkId → the colour and initials that clerkId wears everywhere on this
   * screen.
   *
   * Keyed off the server's order, which is the whole reason a person's
   * colour does not move when somebody else is invited — and off who is
   * looking, because you are always blue. See lib/collaboratorColors.
   */
  const personStyleById = useMemo(() => {
    const colorById = collaboratorColorMap(collaborators, myClerkId);
    return new Map(
      collaborators.map((person) => [
        person.clerkId,
        {
          color: colorById.get(person.clerkId) ?? colors.primary,
          label: badgeInitials(person),
        },
      ])
    );
  }, [collaborators, myClerkId, colors.primary]);

  const { mutateAsync: followPlaylist } = useFollowPlaylist();
  const { mutateAsync: unfollowPlaylist } = useUnfollowPlaylist();
  const [followBusy, setFollowBusy] = useState(false);

  const handleToggleFollow = useCallback(async () => {
    if (!playlist) return;
    setFollowBusy(true);
    try {
      if (playlist.isFollowed) {
        await unfollowPlaylist({ id: numericId });
      } else {
        await followPlaylist({ id: numericId });
      }
      await queryClient.invalidateQueries({ queryKey: getGetPlaylistQueryKey(numericId) });
      await queryClient.invalidateQueries({ queryKey: getGetFollowedPlaylistsQueryKey() });
    } catch {
      Alert.alert('Error', playlist.isFollowed ? 'Could not unfollow this playlist.' : 'Could not follow this playlist.');
    } finally {
      setFollowBusy(false);
    }
  }, [playlist, numericId, followPlaylist, unfollowPlaylist, queryClient]);

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
      // From the playlist item, which is the only record of where a film
      // came from when it was added to a list and not to the locker.
      sourceUrl: item.sourceUrl ?? null,
    });
  }, [savedByTmdbId]);

  const renderItem = useCallback(({ item }: { item: PlaylistItem }) => {
    /**
     * Who on this list has seen this film.
     *
     * Only present on a shared list — the server leaves watchedBy off a
     * solo one, where a badge saying "you have seen it" next to the tick
     * saying the same thing would be noise. personStyleById is empty then
     * too, so this is an empty array and the card draws nothing.
     */
    const badges: MovieCardBadge[] = (item.watchedBy ?? []).flatMap((clerkId) => {
      const style = personStyleById.get(clerkId);
      return style ? [{ key: clerkId, label: style.label, color: style.color }] : [];
    });

    return (
      <MovieCard
        id={item.tmdbId}
        title={item.filmTitle}
        releaseYear={savedByTmdbId.get(item.tmdbId)?.releaseYear ?? ''}
        posterUrl={item.posterUrl}
        onPress={() => openItemModal(item)}
        onLongPress={canEdit ? () => handleRemove(item.tmdbId, item.filmTitle) : undefined}
        isWatched={watchedTmdbIds.has(item.tmdbId)}
        badges={badges}
      />
    );
  }, [savedByTmdbId, openItemModal, handleRemove, canEdit, watchedTmdbIds, personStyleById]);

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
        runtime: saved?.runtime,
        // Both ratings, without which the rating filter and the two rating
        // orders had nothing to read on this screen — the merge stopped at
        // the fields the categorical filters needed.
        rating: saved?.rating,
        tmdbRating: saved?.tmdbRating,
        // A playlist item calls its title filmTitle, and the sort reads
        // `title` — so sorting alphabetically did nothing at all until
        // these were mapped across. The release year only exists on the
        // saved row, so that order is empty for films nobody here owns,
        // which the sort already handles by sinking them.
        title: item.filmTitle,
        releaseYear: saved?.releaseYear,
        // Taken from the watched set rather than from `saved`, so a film
        // someone else put in this playlist is still ticked and still
        // filterable if the viewer has seen it — the saved row only
        // exists for films already in their own locker.
        isWatched: watchedTmdbIds.has(item.tmdbId),
      };
    }),
    [items, savedByTmdbId, watchedTmdbIds]
  );
  const filteredItems = useMemo(
    () => applySort(applyFilters(filterableItems, filters), sort),
    [filterableItems, filters, sort]
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          {isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              <Text style={styles.headerTitle} numberOfLines={1}>{playlist?.name ?? 'Playlist'}</Text>
              <View style={styles.headerMeta}>
                <Ionicons
                  name={playlist?.isPublic ? 'globe-outline' : 'lock-closed-outline'}
                  size={12}
                  color={colors.textFaint}
                />
                <Text style={styles.headerMetaText}>
                  {playlist?.isPublic ? 'Public' : 'Private'} · {items.length} film{items.length !== 1 ? 's' : ''}
                </Text>
              </View>
            </>
          )}
        </View>
        {isOwner ? (
          // Send sits before edit, because sending a list is the thing an
          // owner does repeatedly and editing is the thing they did once.
          <View style={styles.ownerActions}>
            <TouchableOpacity
              onPress={() => setCollabVisible(true)}
              style={styles.editBtn}
              activeOpacity={0.7}
              accessibilityLabel="Manage who can edit this playlist"
            >
              <Ionicons name="people-outline" size={20} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShareVisible(true)}
              style={styles.editBtn}
              activeOpacity={0.7}
              accessibilityLabel="Send this playlist to people"
            >
              <Ionicons name="paper-plane-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEditVisible(true)} style={styles.editBtn} activeOpacity={0.7}>
              <Ionicons name="pencil-outline" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : canEdit && playlist ? (
          // A collaborator: adding films and seeing who else is on the list,
          // and nothing else. No Follow button — they are already on it,
          // which is more than following.
          <View style={styles.ownerActions}>
            <TouchableOpacity
              onPress={() => setCollabVisible(true)}
              style={styles.editBtn}
              activeOpacity={0.7}
              accessibilityLabel="See who can edit this playlist"
            >
              <Ionicons name="people-outline" size={20} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setAddVisible(true)}
              style={styles.editBtn}
              activeOpacity={0.7}
              accessibilityLabel="Add films to this playlist"
            >
              <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
            </TouchableOpacity>
          </View>
        ) : playlist ? (
          <TouchableOpacity
            onPress={handleToggleFollow}
            disabled={followBusy}
            style={[styles.followBtn, playlist.isFollowed && styles.followingBtn]}
            activeOpacity={0.8}
          >
            {followBusy ? (
              <ActivityIndicator size="small" color={playlist.isFollowed ? colors.textStrong : colors.background} />
            ) : (
              <Text style={[styles.followBtnText, playlist.isFollowed && styles.followingBtnText]}>
                {playlist.isFollowed ? 'Following' : 'Follow'}
              </Text>
            )}
          </TouchableOpacity>
        ) : (
          // Placeholder of the same width so the title stays optically centred
          // between the back button and this edge while loading.
          <View style={styles.editBtn} />
        )}
      </View>

      {/* The key to the badges on the posters: who is on this list and what
          colour they are. Shown to everyone who can see the list, not just
          the people on it — a stranger looking at a public list sees the
          badges too, and without this they would be unexplained dots.

          Each name is its own tap, to that person's profile. A shared list
          is the main way you meet the owner's friends rather than your own,
          and until now they were two letters and a colour with no way to
          find out who they were or to follow them. Your own chip does not
          navigate: it is the one person here who needs no introduction.

          Hidden on a solo list, where there are no badges to explain. */}
      {collaborators.length > 1 && (
        <View style={styles.collabStrip}>
          <Ionicons name="people-outline" size={14} color={colors.textFaint} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.collabChips}
          >
            {collaborators.map((person) => {
              const isMe = person.clerkId === myClerkId;
              const color = personStyleById.get(person.clerkId)?.color ?? colors.primary;
              return (
                <TouchableOpacity
                  key={person.clerkId}
                  style={[styles.collabChip, { borderColor: color }]}
                  onPress={() => router.push(`/user/${person.clerkId}`)}
                  disabled={isMe}
                  activeOpacity={0.7}
                  accessibilityLabel={
                    isMe ? 'You' : `See ${person.username ?? 'this person'}'s profile`
                  }
                >
                  <View style={[styles.collabDot, { backgroundColor: color }]} />
                  <Text style={styles.collabChipText} numberOfLines={1}>
                    {isMe ? 'You' : (person.username ?? badgeInitials(person))}
                  </Text>
                  {!isMe && (
                    <Ionicons name="chevron-forward" size={10} color={colors.textFaint} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {/* Managing who is on the list is a separate thing from looking
              somebody up, so it gets its own target rather than sharing the
              strip's. */}
          {canEdit && (
            <TouchableOpacity
              onPress={() => setCollabVisible(true)}
              hitSlop={8}
              activeOpacity={0.7}
              accessibilityLabel="Manage collaborators"
            >
              <Ionicons name="settings-outline" size={15} color={colors.textFaint} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {isLoading ? (
        <View style={styles.skeletonGrid}>
          {[...Array(6)].map((_, i) => (
            <MovieCardSkeleton key={i} />
          ))}
        </View>
      ) : isError ? (
        <LoadError
          title="Could not load this playlist"
          error={error}
          onRetry={refetch}
          retrying={isRefetching}
        />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="film-outline" size={56} color={colors.iconFaint} />
          <Text style={styles.emptyTitle}>Empty playlist</Text>
          <Text style={styles.emptySub}>
            Add films from the watchlist or film detail screens.
          </Text>
        </View>
      ) : (
        <>
          <FilterBar
            movies={filterableItems}
            filters={filters}
            onChange={setFilters}
            sort={sort}
            onSortChange={setSort}
            // No "date watched": a playlist is a list of films, not a
            // record of having seen them. "Date added" is when it joined
            // THIS list, which is what addedAt holds on a playlist item.
            sortOptions={['none', 'added', 'myRating', 'tmdbRating', 'runtime', 'title', 'year']}
            // A playlist mixes seen and unseen, which the Films tabs never
            // do — their own toggle has already answered it.
            showWatched
            sortDefault={{ key: 'none', direction: 'desc' }}
            sortDefaultLabel="Playlist order"
          />

          {filteredItems.length > 0 && (
            <View style={styles.sectionLabelRow}>
              <Text style={styles.sectionLabel}>
                {filteredItems.length} FILM{filteredItems.length === 1 ? '' : 'S'}
              </Text>
              {canEdit && <Text style={styles.sectionHint}>Hold to remove</Text>}
            </View>
          )}

          <View style={styles.gridArea}>
          <FlatList
            data={filteredItems}
            numColumns={3}
            keyExtractor={(item) => String(item.tmdbId)}
            renderItem={renderItem}
            columnWrapperStyle={styles.columnWrapper}
            contentContainerStyle={[styles.contentContainer, { paddingBottom: insets.bottom + 16 }]}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="film-outline" size={56} color={colors.iconFaint} />
                <Text style={styles.emptyTitle}>No films match your filters</Text>
                <Text style={styles.emptySub}>Try clearing your filters</Text>
              </View>
            }
          />
          <GridTopCaps />
          </View>
        </>
      )}

      {playlist && isOwner && (
        <SharePlaylistSheet
          visible={shareVisible}
          onClose={() => setShareVisible(false)}
          playlistId={playlist.id}
          playlistName={playlist.name}
        />
      )}

      {playlist && canEdit && (
        <CollaboratorsSheet
          visible={collabVisible}
          onClose={() => setCollabVisible(false)}
          playlistId={playlist.id}
          playlistName={playlist.name}
          collaborators={collaborators}
          maxCollaborators={maxCollaborators}
          isOwner={isOwner}
          myClerkId={myClerkId}
          onChanged={invalidate}
          // Leaving a private list means it is no longer visible, so staying
          // on it would mean sitting on a screen that reloads into a 403.
          onLeft={() => router.back()}
        />
      )}

      {playlist && canEdit && !isOwner && (
        <AddFilmsSheet
          visible={addVisible}
          onClose={() => setAddVisible(false)}
          playlistId={numericId}
          playlistName={playlist.name}
          existingTmdbIds={existingTmdbIds}
          onFilmAdded={invalidate}
        />
      )}

      {playlist && isOwner && (
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
          sourceUrl={modalTarget.sourceUrl}
        />
      )}
    </View>
  );
}

const HORIZONTAL_PADDING = 16;
const COLUMN_GAP = 10;

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  backBtn: { padding: 4 },
  headerCenter: { flex: 1, marginHorizontal: 12 },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: c.text },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  headerMetaText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textFaint },
  ownerActions: { flexDirection: 'row', alignItems: 'center' },
  editBtn: { padding: 8 },
  followBtn: {
    backgroundColor: c.primary,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 16,
    minWidth: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followingBtn: { backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border },
  followBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.onColor },
  followingBtnText: { color: c.textStrong },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: c.textStrong },
  emptySub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: c.textFaint, textAlign: 'center', lineHeight: 20 },

  contentContainer: { paddingHorizontal: HORIZONTAL_PADDING },
  /** Holds the list and the rounded caps drawn on top of it. */
  gridArea: { flex: 1, overflow: 'hidden' },
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
  sectionLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: c.textFaint, letterSpacing: 1.5 },

  collabStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: HORIZONTAL_PADDING, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
  },
  collabChips: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 4 },
  collabChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 11, borderWidth: 1,
    maxWidth: 140,
  },
  collabDot: { width: 8, height: 8, borderRadius: 4 },
  collabChipText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: c.textMuted },
  sectionHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: c.textFaint },
});
