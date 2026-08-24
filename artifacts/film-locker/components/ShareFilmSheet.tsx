/**
 * ShareFilmSheet
 *
 * Bottom sheet shown after the app processes a shared URL in dry-run mode.
 * Displays each identified film with poster/title, lets the user tap
 * "Add to Watchlist", and offers a "Return to [app]" action once done.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Platform,
  BackHandler,
  ActivityIndicator,
  TextInput,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  useAddMovie,
  useGetMyPlaylists,
  useCreatePlaylist,
  useAddPlaylistItem,
  getListMoviesQueryKey,
  getGetMyPlaylistsQueryKey,
  type GeminiMovieMatch,
  type Playlist,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useToast } from '@/components/ToastProvider';
import { webInputReset } from '@/lib/webInputReset';
import { ErrorBoundary } from '@/components/ErrorBoundary';

interface ShareFilmSheetProps {
  visible: boolean;
  /** Matches returned by the dry-run processLink call */
  matches: GeminiMovieMatch[];
  /** Suggested playlist name when the share was a curated/ranked list, e.g. "Top 10 Horror Films of All Time" */
  listTitle?: string | null;
  onClose: () => void;
  /**
   * Exit the app after the user is done — correct for the Android share-intent
   * flow, which should return to whatever app the user shared from. Pass
   * false when the sheet is opened from inside Film Locker itself (e.g. the
   * watchlist screen's paste-link box), where "done" should just dismiss the
   * sheet. Defaults to true to preserve the share-intent behavior.
   */
  exitAppOnReturn?: boolean;
}

const CONFIDENCE_THRESHOLD = 0.45;
const { height: SCREEN_H } = Dimensions.get('window');

/** Single film card inside the sheet */
function FilmCard({
  match,
  onAdded,
}: {
  match: GeminiMovieMatch;
  onAdded: () => void;
}) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { mutateAsync: addMovie, isPending } = useAddMovie();
  const [added, setAdded] = useState(false);

  const handleAdd = useCallback(async () => {
    if (!match.tmdb_id || added || isPending) return;
    try {
      await addMovie({
        data: {
          tmdbId: match.tmdb_id,
          title: match.title ?? match.movie_title,
          releaseYear: match.release_year,
          posterUrl: match.poster_url ?? '',
          overview: match.overview ?? '',
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListMoviesQueryKey() });
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setAdded(true);
      onAdded();
    } catch {
      showToast({ title: 'Could not add film', subtitle: 'Check your connection and try again.', variant: 'error' });
    }
  }, [match, added, isPending, addMovie, queryClient, showToast, onAdded]);

  const displayTitle = match.title ?? match.movie_title;
  const posterUri = match.poster_url;

  return (
    <View style={[cardStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Poster */}
      {posterUri ? (
        <Image
          source={{ uri: posterUri }}
          style={cardStyles.poster}
          contentFit="cover"
          transition={200}
          placeholder={require('@/assets/images/icon.png')}
        />
      ) : (
        <View style={[cardStyles.poster, cardStyles.posterFallback, { backgroundColor: colors.secondary }]}>
          <Text style={{ fontSize: 28 }}>🎬</Text>
        </View>
      )}

      {/* Info */}
      <View style={cardStyles.info}>
        <Text style={[cardStyles.title, { color: colors.foreground }]} numberOfLines={2}>
          {displayTitle}
        </Text>
        {match.release_year ? (
          <Text style={[cardStyles.year, { color: colors.primary }]}>
            {match.release_year}
          </Text>
        ) : null}
        {match.overview ? (
          <Text style={[cardStyles.overview, { color: colors.mutedForeground }]} numberOfLines={3}>
            {match.overview}
          </Text>
        ) : null}

        {/* Add button */}
        {added ? (
          <View style={cardStyles.addedRow}>
            <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
            <Text style={cardStyles.addedText}>Added to Watchlist</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[cardStyles.addBtn, { backgroundColor: colors.primary }]}
            onPress={handleAdd}
            disabled={isPending || !match.tmdb_id}
            activeOpacity={0.8}
          >
            {isPending ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Ionicons name="bookmark-outline" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={cardStyles.addBtnText}>Add to Watchlist</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  poster: { width: 70, height: 105, borderRadius: 8, flexShrink: 0 },
  posterFallback: { alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1 },
  title: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    lineHeight: 20,
    marginBottom: 3,
  },
  year: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 6,
  },
  overview: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 17,
    marginBottom: 10,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  addBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  addedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  addedText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#16A34A',
  },
});

// ── Film selection row (checklist shown before choosing a destination) ───────

function FilmSelectRow({
  match,
  selected,
  onToggle,
}: {
  match: GeminiMovieMatch;
  selected: boolean;
  onToggle: () => void;
}) {
  const colors = useColors();
  const displayTitle = match.title ?? match.movie_title;

  return (
    <TouchableOpacity
      style={[selectStyles.row, { borderColor: colors.border }]}
      onPress={onToggle}
      activeOpacity={0.75}
    >
      {match.poster_url ? (
        <Image
          source={{ uri: match.poster_url }}
          style={selectStyles.poster}
          contentFit="cover"
          transition={200}
          placeholder={require('@/assets/images/icon.png')}
        />
      ) : (
        <View style={[selectStyles.poster, selectStyles.posterFallback, { backgroundColor: colors.secondary }]}>
          <Text style={{ fontSize: 18 }}>🎬</Text>
        </View>
      )}
      <View style={selectStyles.info}>
        <Text style={[selectStyles.title, { color: colors.foreground }]} numberOfLines={1}>
          {displayTitle}
        </Text>
        {match.release_year ? (
          <Text style={[selectStyles.year, { color: colors.mutedForeground }]}>{match.release_year}</Text>
        ) : null}
      </View>
      <Ionicons
        name={selected ? 'checkbox' : 'square-outline'}
        size={24}
        color={selected ? colors.primary : colors.mutedForeground}
      />
    </TouchableOpacity>
  );
}

const selectStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  poster: { width: 40, height: 58, borderRadius: 6, flexShrink: 0 },
  posterFallback: { alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1 },
  title: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  year: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },
});

// ── Bulk add panel (playlist / watchlist / both) — acts on the selected set ──

type BulkAddMode = 'playlist' | 'watchlist' | 'both';

function BulkAddPanel({
  candidates,
  mode,
  initialName,
  onDone,
}: {
  /** Already the user-selected subset — not the full match list. */
  candidates: GeminiMovieMatch[];
  mode: BulkAddMode;
  /** Prefills the "new playlist" name input, e.g. a detected list_title. */
  initialName?: string | null;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { data } = useGetMyPlaylists({
    query: { queryKey: getGetMyPlaylistsQueryKey() },
  });
  const { mutateAsync: createPlaylist, isPending: creating } = useCreatePlaylist();
  const { mutateAsync: addItem } = useAddPlaylistItem();
  const { mutateAsync: addMovie } = useAddMovie();

  const alsoAddToWatchlist = mode === 'both';

  const [newName, setNewName] = useState(initialName ?? '');
  const [addingTo, setAddingTo] = useState<number | 'watchlist' | null>(mode === 'watchlist' ? 'watchlist' : null);
  const [done, setDone] = useState(false);

  const playlists = data?.playlists ?? [];

  const addAllToWatchlistOnly = useCallback(async () => {
    let added = 0;
    for (const m of candidates) {
      if (!m.tmdb_id) continue;
      try {
        await addMovie({
          data: {
            tmdbId: m.tmdb_id,
            title: m.title ?? m.movie_title,
            releaseYear: m.release_year,
            posterUrl: m.poster_url ?? '',
            overview: m.overview ?? '',
          },
        });
        added++;
      } catch { /* already in watchlist — skip */ }
    }
    await queryClient.invalidateQueries({ queryKey: getListMoviesQueryKey() });
    setAddingTo(null);
    setDone(true);
    showToast({ title: `Added ${added} film${added !== 1 ? 's' : ''} to watchlist`, variant: 'success' });
    setTimeout(onDone, 1200);
  }, [candidates, addMovie, queryClient, showToast, onDone]);

  // Watchlist-only mode has no destination to pick — run immediately.
  useEffect(() => {
    if (mode === 'watchlist') {
      addAllToWatchlistOnly();
    }
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addAllToPlaylist = useCallback(async (playlistId: number) => {
    setAddingTo(playlistId);
    let added = 0;
    for (const m of candidates) {
      if (!m.tmdb_id) continue;
      try {
        await addItem({
          id: playlistId,
          data: {
            tmdbId: m.tmdb_id,
            filmTitle: m.title ?? m.movie_title,
            posterUrl: m.poster_url ?? '',
          },
        });
        added++;
      } catch { /* already in playlist — skip */ }

      if (alsoAddToWatchlist) {
        try {
          await addMovie({
            data: {
              tmdbId: m.tmdb_id,
              title: m.title ?? m.movie_title,
              releaseYear: m.release_year,
              posterUrl: m.poster_url ?? '',
              overview: m.overview ?? '',
            },
          });
        } catch { /* already in watchlist — skip */ }
      }
    }
    await queryClient.invalidateQueries({ queryKey: getGetMyPlaylistsQueryKey() });
    if (alsoAddToWatchlist) {
      await queryClient.invalidateQueries({ queryKey: getListMoviesQueryKey() });
    }
    setAddingTo(null);
    setDone(true);
    const summary = alsoAddToWatchlist
      ? `Added ${added} film${added !== 1 ? 's' : ''} to playlist and watchlist`
      : `Added ${added} film${added !== 1 ? 's' : ''} to playlist`;
    showToast({ title: summary, variant: 'success' });
    setTimeout(onDone, 1200);
  }, [candidates, addItem, addMovie, alsoAddToWatchlist, queryClient, showToast, onDone]);

  const handleCreateAndAdd = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const pl = await createPlaylist({ data: { name, isPublic: false } }) as Playlist;
      await addAllToPlaylist(pl.id);
    } catch {
      showToast({ title: 'Could not create playlist', variant: 'error' });
    }
  }, [newName, createPlaylist, addAllToPlaylist, showToast]);

  if (mode === 'watchlist') {
    return (
      <View style={ppStyles.doneWrap}>
        {done ? (
          <>
            <Ionicons name="checkmark-circle" size={44} color="#16A34A" />
            <Text style={ppStyles.doneText}>Films added to watchlist!</Text>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color="#0066FF" />
            <Text style={ppStyles.doneText}>Adding {candidates.length} film{candidates.length !== 1 ? 's' : ''} to watchlist…</Text>
          </>
        )}
      </View>
    );
  }

  if (done) {
    return (
      <View style={ppStyles.doneWrap}>
        <Ionicons name="checkmark-circle" size={44} color="#16A34A" />
        <Text style={ppStyles.doneText}>
          {alsoAddToWatchlist ? 'Films added to playlist and watchlist!' : 'Films added to playlist!'}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={ppStyles.root} keyboardShouldPersistTaps="handled">
      <Text style={ppStyles.heading}>{alsoAddToWatchlist ? 'Save to playlist + watchlist' : 'Save to a playlist'}</Text>
      <Text style={ppStyles.sub}>{candidates.length} film{candidates.length !== 1 ? 's' : ''} will be added</Text>

      {/* Existing playlists — tap to add the selected films straight in */}
      {playlists.length > 0 && (
        <>
          <Text style={ppStyles.sectionLabel}>ADD TO EXISTING</Text>
          {playlists.map((pl) => (
            <TouchableOpacity
              key={pl.id}
              style={ppStyles.plRow}
              onPress={() => addAllToPlaylist(pl.id)}
              disabled={addingTo !== null}
              activeOpacity={0.75}
            >
              <View style={ppStyles.plIcon}>
                <Ionicons name={pl.isPublic ? 'globe-outline' : 'lock-closed-outline'} size={16} color="#6B7280" />
              </View>
              <View style={ppStyles.plInfo}>
                <Text style={ppStyles.plName}>{pl.name}</Text>
                <Text style={ppStyles.plCount}>{pl.itemCount} film{pl.itemCount !== 1 ? 's' : ''}</Text>
              </View>
              {addingTo === pl.id ? (
                <ActivityIndicator size="small" color="#0066FF" />
              ) : (
                <Ionicons name="add-circle-outline" size={22} color="#0066FF" />
              )}
            </TouchableOpacity>
          ))}
        </>
      )}

      {/* Create new — always visible, prefilled from the detected list title
          (e.g. "Best Feel Good Movies") when there is one, but always editable. */}
      <Text style={ppStyles.sectionLabel}>{playlists.length > 0 ? 'OR CREATE NEW' : 'NEW PLAYLIST'}</Text>
      <View style={ppStyles.newRow}>
        <TextInput
          style={ppStyles.newInput}
          value={newName}
          onChangeText={setNewName}
          placeholder="New playlist name…"
          placeholderTextColor="#9CA3AF"
          maxLength={100}
          returnKeyType="done"
          onSubmitEditing={handleCreateAndAdd}
        />
        <TouchableOpacity
          style={ppStyles.newCreate}
          onPress={handleCreateAndAdd}
          disabled={!newName.trim() || creating || addingTo !== null}
          activeOpacity={0.8}
        >
          {creating ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={ppStyles.newCreateText}>Create</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const ppStyles = StyleSheet.create({
  root: { padding: 16 },
  heading: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#111827', marginBottom: 4 },
  sub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginBottom: 16 },
  plRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  plIcon: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#F9FAFB', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  plInfo: { flex: 1 },
  plName: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#111827' },
  plCount: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },
  sectionLabel: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#9CA3AF',
    letterSpacing: 0.8, marginTop: 16, marginBottom: 4,
  },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  newInput: {
    flex: 1, height: 40, paddingHorizontal: 12,
    backgroundColor: '#F9FAFB', borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB',
    fontSize: 14, fontFamily: 'Inter_400Regular', color: '#111827',
    ...webInputReset,
  },
  newCreate: { backgroundColor: '#0066FF', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  newCreateText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  doneWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 12 },
  doneText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#111827' },
});

// ── Crash fallback ────────────────────────────────────────────────────────────
// Renders inside the sheet if anything below throws during render, instead of
// leaving the Modal's dark backdrop on screen with nothing on top of it (the
// "grey screen, nothing happens" report). Surfaces the actual error message
// on-screen so a report of this includes the real cause, not just a screenshot
// of a blank overlay.

function SheetCrashFallback({ error, onClose }: { error: Error; onClose: () => void }) {
  return (
    <View style={crashStyles.wrap}>
      <Ionicons name="warning-outline" size={40} color="#DC2626" />
      <Text style={crashStyles.title}>Couldn't show these results</Text>
      <Text style={crashStyles.message} selectable>
        {error.message || 'Unknown error'}
      </Text>
      <TouchableOpacity style={crashStyles.closeBtn} onPress={onClose} activeOpacity={0.85}>
        <Text style={crashStyles.closeBtnText}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}

const crashStyles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 10 },
  title: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#111827', textAlign: 'center' },
  message: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#6B7280', textAlign: 'center' },
  closeBtn: { marginTop: 8, backgroundColor: '#EF4444', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24 },
  closeBtnText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});

// ── Main sheet ────────────────────────────────────────────────────────────────

export function ShareFilmSheet({ visible, matches, listTitle, onClose, exitAppOnReturn = true }: ShareFilmSheetProps) {
  const colors = useColors();
  const [addedCount, setAddedCount] = useState(0);
  const [multiMode, setMultiMode] = useState<BulkAddMode | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Bumped every time the sheet opens fresh — remounts the ErrorBoundary below
  // so a crash on one share doesn't permanently wedge the fallback UI in place
  // for every share after it.
  const [openId, setOpenId] = useState(0);

  // Candidates are matches that passed confidence threshold and have a TMDB id
  const candidates = matches.filter(
    (m) => m.confidence_score >= CONFIDENCE_THRESHOLD && m.tmdb_id != null
  );

  // 3+ films offer the playlist/watchlist/both picker; 1-2 use the simpler
  // per-card "Add to Watchlist" flow below instead.
  const isMultiFilm = candidates.length > 2;
  const selectedCandidates = candidates.filter((m) => selectedIds.has(String(m.tmdb_id)));

  // Reset state when sheet opens for a new share — default selection is "all".
  useEffect(() => {
    if (visible) {
      setAddedCount(0);
      setMultiMode(null);
      setOpenId((n) => n + 1);
      setSelectedIds(new Set(matches
        .filter((m) => m.confidence_score >= CONFIDENCE_THRESHOLD && m.tmdb_id != null)
        .map((m) => String(m.tmdb_id))
      ));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggleSelected = useCallback((tmdbId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const key = String(tmdbId);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const handleAdded = useCallback(() => {
    setAddedCount((n) => n + 1);
  }, []);

  const handleReturn = useCallback(() => {
    onClose();
    if (exitAppOnReturn) {
      setTimeout(() => {
        BackHandler.exitApp();
      }, 200);
    }
  }, [onClose, exitAppOnReturn]);

  const doneLabel = exitAppOnReturn ? 'Return to previous app' : 'Done';
  const skipLabel = exitAppOnReturn ? 'Return without adding' : 'Close';

  const allAdded = candidates.length > 0 && addedCount >= candidates.length;

  // Derive header text
  const headerTitle = candidates.length > 0
    ? `🎬 ${candidates.length} Film${candidates.length !== 1 ? 's' : ''} Found`
    : 'No Film Found';
  const headerSub = candidates.length > 0
    ? (listTitle ? `"${listTitle}" — ${candidates.length} film${candidates.length !== 1 ? 's' : ''} identified` : `${candidates.length} film${candidates.length !== 1 ? 's' : ''} identified from this link`)
    : 'Gemini could not identify a film in this post';

  return (
    <Modal transparent visible={visible} onRequestClose={onClose} animationType="slide" statusBarTranslucent>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              paddingBottom: Platform.OS === 'ios' ? 34 : 20,
            },
          ]}
        >
          {/* Prevent inner taps from closing the sheet */}
          <TouchableOpacity activeOpacity={1} style={{ flex: 1 }}>

            {/* Handle bar */}
            <View style={styles.handleContainer}>
              <View style={[styles.handle, { backgroundColor: colors.border }]} />
            </View>

            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.headerTitle, { color: colors.foreground }]}>{headerTitle}</Text>
                <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>{headerSub}</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
                <Ionicons name="close" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {/* Content — wrapped so a render error shows a real message instead
                of leaving the backdrop blank with nothing on top of it. */}
            <ErrorBoundary
              key={openId}
              FallbackComponent={({ error }) => <SheetCrashFallback error={error} onClose={onClose} />}
            >
            {multiMode !== null ? (
              /* Bulk add panel — acts on whatever was checked in the selection list */
              <BulkAddPanel
                candidates={selectedCandidates}
                mode={multiMode}
                initialName={listTitle}
                onDone={handleReturn}
              />
            ) : candidates.length === 0 ? (
              <>
                <View style={styles.scrollContent}>
                  <View style={styles.emptyState}>
                    <Ionicons name="film-outline" size={44} color={colors.mutedForeground} />
                    <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No film identified</Text>
                    <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                      Try sharing a post with a visible film title or caption.
                    </Text>
                  </View>
                </View>
                <View style={[styles.footer, { borderTopColor: colors.border }]}>
                  <TouchableOpacity
                    style={[styles.returnBtn, { backgroundColor: colors.muted }]}
                    onPress={handleReturn}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="arrow-back" size={18} color={colors.mutedForeground} style={{ marginRight: 8 }} />
                    <Text style={[styles.returnBtnText, { color: colors.mutedForeground }]}>
                      {skipLabel}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : isMultiFilm ? (
              <>
                {/* Selection checklist — every film defaults to selected */}
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={styles.scrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.selectHeaderRow}>
                    <Text style={[styles.selectCount, { color: colors.mutedForeground }]}>
                      {selectedCandidates.length} of {candidates.length} selected
                    </Text>
                    <TouchableOpacity
                      onPress={() => setSelectedIds(
                        selectedCandidates.length === candidates.length
                          ? new Set()
                          : new Set(candidates.map((m) => String(m.tmdb_id)))
                      )}
                    >
                      <Text style={styles.selectAllBtn}>
                        {selectedCandidates.length === candidates.length ? 'Deselect all' : 'Select all'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {candidates.map((match, i) => (
                    <FilmSelectRow
                      key={`${match.tmdb_id ?? match.movie_title}-${i}`}
                      match={match}
                      selected={selectedIds.has(String(match.tmdb_id))}
                      onToggle={() => match.tmdb_id != null && toggleSelected(match.tmdb_id)}
                    />
                  ))}
                </ScrollView>

                {/* Footer — destination actions, act on the selected set */}
                <View style={[styles.footer, { borderTopColor: colors.border }]}>
                  <View style={styles.multiSelector}>
                    <TouchableOpacity
                      style={[styles.multiBtn, selectedCandidates.length === 0 && styles.multiBtnDisabled]}
                      onPress={() => setMultiMode('watchlist')}
                      disabled={selectedCandidates.length === 0}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="bookmark-outline" size={18} color="#0066FF" style={{ marginRight: 8 }} />
                      <Text style={styles.multiBtnText}>Add to Watchlist ({selectedCandidates.length})</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.multiBtn, styles.multiBtnSecondary, selectedCandidates.length === 0 && styles.multiBtnDisabled]}
                      onPress={() => setMultiMode('playlist')}
                      disabled={selectedCandidates.length === 0}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="list-outline" size={18} color="#6B7280" style={{ marginRight: 8 }} />
                      <Text style={[styles.multiBtnText, { color: '#6B7280' }]}>Add to Playlist</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.multiBtn, styles.multiBtnSecondary, selectedCandidates.length === 0 && styles.multiBtnDisabled]}
                      onPress={() => setMultiMode('both')}
                      disabled={selectedCandidates.length === 0}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="albums-outline" size={18} color="#6B7280" style={{ marginRight: 8 }} />
                      <Text style={[styles.multiBtnText, { color: '#6B7280' }]}>Add to Both</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            ) : (
              <>
                {/* Single film — unchanged inline add-to-watchlist flow */}
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={styles.scrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  {candidates.map((match, i) => (
                    <FilmCard
                      key={`${match.tmdb_id ?? match.movie_title}-${i}`}
                      match={match}
                      onAdded={handleAdded}
                    />
                  ))}
                </ScrollView>

                <View style={[styles.footer, { borderTopColor: colors.border }]}>
                  {allAdded ? (
                    <TouchableOpacity
                      style={[styles.returnBtn, { backgroundColor: '#16A34A' }]}
                      onPress={handleReturn}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="arrow-back" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                      <Text style={styles.returnBtnText}>{doneLabel}</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.returnBtn, { backgroundColor: colors.muted }]}
                      onPress={handleReturn}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="arrow-back" size={18} color={colors.mutedForeground} style={{ marginRight: 8 }} />
                      <Text style={[styles.returnBtnText, { color: colors.mutedForeground }]}>
                        {skipLabel}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}
            </ErrorBoundary>

          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: SCREEN_H * 0.85,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
  },
  handleContainer: { alignItems: 'center', paddingTop: 12, paddingBottom: 8 },
  handle: { width: 38, height: 4, borderRadius: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.2,
  },
  headerSub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: 3,
    lineHeight: 18,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 4,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 19,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  returnBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 12,
  },
  returnBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFFFFF',
  },
  multiSelector: {
    gap: 10,
  },
  multiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#93C5FD',
  },
  multiBtnSecondary: {
    backgroundColor: '#F9FAFB',
    borderColor: '#E5E7EB',
  },
  multiBtnDisabled: {
    opacity: 0.5,
  },
  multiBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#0066FF',
  },
  selectHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  selectCount: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  selectAllBtn: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#0066FF',
  },
});
