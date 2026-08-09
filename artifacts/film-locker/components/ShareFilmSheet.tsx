/**
 * ShareFilmSheet
 *
 * Bottom sheet shown after the app processes a shared URL in dry-run mode.
 * Displays each identified film with poster/title, lets the user tap
 * "Add to Watchlist", and offers a "Return to [app]" action once done.
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Animated,
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

interface ShareFilmSheetProps {
  visible: boolean;
  /** Matches returned by the dry-run processLink call */
  matches: GeminiMovieMatch[];
  onClose: () => void;
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

// ── Playlist picker (used in multi-film mode) ────────────────────────────────

function PlaylistPicker({
  candidates,
  onDone,
}: {
  candidates: GeminiMovieMatch[];
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { data } = useGetMyPlaylists({
    query: { queryKey: getGetMyPlaylistsQueryKey() },
  });
  const { mutateAsync: createPlaylist, isPending: creating } = useCreatePlaylist();
  const { mutateAsync: addItem } = useAddPlaylistItem();

  const [newName, setNewName] = useState('');
  const [showNewInput, setShowNewInput] = useState(false);
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  const playlists = data?.playlists ?? [];

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
    }
    await queryClient.invalidateQueries({ queryKey: getGetMyPlaylistsQueryKey() });
    setAddingTo(null);
    setDone(true);
    showToast({ title: `Added ${added} film${added !== 1 ? 's' : ''} to playlist`, variant: 'success' });
    setTimeout(onDone, 1200);
  }, [candidates, addItem, queryClient, showToast, onDone]);

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

  if (done) {
    return (
      <View style={ppStyles.doneWrap}>
        <Ionicons name="checkmark-circle" size={44} color="#16A34A" />
        <Text style={ppStyles.doneText}>Films added to playlist!</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={ppStyles.root} keyboardShouldPersistTaps="handled">
      <Text style={ppStyles.heading}>Save to a playlist</Text>
      <Text style={ppStyles.sub}>{candidates.length} films will be added</Text>

      {/* Existing playlists */}
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

      {/* Create new */}
      {showNewInput ? (
        <View style={ppStyles.newRow}>
          <TextInput
            style={ppStyles.newInput}
            value={newName}
            onChangeText={setNewName}
            placeholder="New playlist name…"
            placeholderTextColor="#9CA3AF"
            autoFocus
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
      ) : (
        <TouchableOpacity
          style={ppStyles.newBtn}
          onPress={() => setShowNewInput(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={18} color="#0066FF" style={{ marginRight: 6 }} />
          <Text style={ppStyles.newBtnText}>Create new playlist</Text>
        </TouchableOpacity>
      )}
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
  newBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  newBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#0066FF' },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  newInput: {
    flex: 1, height: 40, paddingHorizontal: 12,
    backgroundColor: '#F9FAFB', borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB',
    fontSize: 14, fontFamily: 'Inter_400Regular', color: '#111827',
  },
  newCreate: { backgroundColor: '#0066FF', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  newCreateText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  doneWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 12 },
  doneText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#111827' },
});

// ── Main sheet ────────────────────────────────────────────────────────────────

type MultiMode = null | 'individual' | 'playlist';

export function ShareFilmSheet({ visible, matches, onClose }: ShareFilmSheetProps) {
  const colors = useColors();
  const slideAnim = useRef(new Animated.Value(0)).current;
  const [addedCount, setAddedCount] = useState(0);
  const [multiMode, setMultiMode] = useState<MultiMode>(null);

  // Candidates are matches that passed confidence threshold and have a TMDB id
  const candidates = matches.filter(
    (m) => m.confidence_score >= CONFIDENCE_THRESHOLD && m.tmdb_id != null
  );

  const isMultiFilm = candidates.length > 1;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      tension: 60,
      friction: 11,
    }).start();
  }, [visible, slideAnim]);

  // Reset state when sheet opens for a new share
  useEffect(() => {
    if (visible) {
      setAddedCount(0);
      setMultiMode(null);
    }
  }, [visible]);

  const handleAdded = useCallback(() => {
    setAddedCount((n) => n + 1);
  }, []);

  const handleReturn = useCallback(() => {
    onClose();
    setTimeout(() => {
      BackHandler.exitApp();
    }, 200);
  }, [onClose]);

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_H, 0],
  });

  const allAdded = candidates.length > 0 && addedCount >= candidates.length;

  // Derive header text
  const headerTitle = candidates.length > 0
    ? `🎬 ${candidates.length} Film${candidates.length !== 1 ? 's' : ''} Found`
    : 'No Film Found';
  const headerSub = candidates.length > 0
    ? `${candidates.length} film${candidates.length !== 1 ? 's' : ''} identified from this link`
    : 'Gemini could not identify a film in this post';

  return (
    <Modal transparent visible={visible} onRequestClose={onClose} animationType="none">
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              transform: [{ translateY }],
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

            {/* Content */}
            {multiMode === 'playlist' ? (
              /* Playlist picker */
              <PlaylistPicker candidates={candidates} onDone={handleReturn} />
            ) : (
              <>
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={styles.scrollContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {candidates.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Ionicons name="film-outline" size={44} color={colors.mutedForeground} />
                      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No film identified</Text>
                      <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                        Try sharing a post with a visible film title or caption.
                      </Text>
                    </View>
                  ) : (
                    <>
                      {/* Multi-film mode selector */}
                      {isMultiFilm && multiMode === null && (
                        <View style={styles.multiSelector}>
                          <TouchableOpacity
                            style={styles.multiBtn}
                            onPress={() => setMultiMode('playlist')}
                            activeOpacity={0.8}
                          >
                            <Ionicons name="list-outline" size={18} color="#0066FF" style={{ marginRight: 8 }} />
                            <Text style={styles.multiBtnText}>Save all to a playlist</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.multiBtn, styles.multiBtnSecondary]}
                            onPress={() => setMultiMode('individual')}
                            activeOpacity={0.8}
                          >
                            <Ionicons name="apps-outline" size={18} color="#6B7280" style={{ marginRight: 8 }} />
                            <Text style={[styles.multiBtnText, { color: '#6B7280' }]}>Add each separately</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {/* Individual film cards — always shown for 1 film; shown after "add separately" for multi */}
                      {(!isMultiFilm || multiMode === 'individual') &&
                        candidates.map((match, i) => (
                          <FilmCard
                            key={`${match.tmdb_id ?? match.movie_title}-${i}`}
                            match={match}
                            onAdded={handleAdded}
                          />
                        ))
                      }
                    </>
                  )}
                </ScrollView>

                {/* Footer — Return button */}
                <View style={[styles.footer, { borderTopColor: colors.border }]}>
                  {allAdded ? (
                    <TouchableOpacity
                      style={[styles.returnBtn, { backgroundColor: '#16A34A' }]}
                      onPress={handleReturn}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="arrow-back" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                      <Text style={styles.returnBtnText}>Return to previous app</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.returnBtn, { backgroundColor: colors.muted }]}
                      onPress={handleReturn}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="arrow-back" size={18} color={colors.mutedForeground} style={{ marginRight: 8 }} />
                      <Text style={[styles.returnBtnText, { color: colors.mutedForeground }]}>
                        Return without adding
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}

          </TouchableOpacity>
        </Animated.View>
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
    marginBottom: 16,
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
  multiBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#0066FF',
  },
});
