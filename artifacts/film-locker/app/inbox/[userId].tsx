import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, Platform, Modal, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  useGetNotificationThread,
  useReactToNotification,
  useAddMovie,
  getGetNotificationThreadQueryKey,
  getGetNotificationsQueryKey,
  getListMoviesQueryKey,
  type FilmNotification,
  type ReactNotificationBodyReaction,
} from '@workspace/api-client-react';

// Emoji top row — always visible, no scrolling needed (7 fits one row).
const EMOJI_KEYS = ['👍', '👎', '😊', '😍', '😱', '😂', '😢'] as const;

const WATCHED_IT = 'Watched it!';

// "Letter keys" — movie catchphrases instead of letters, laid out as
// horizontally-scrolling keyboard rows. Matches the fixed enum enforced
// server-side by ReactToNotificationBody — there's no way to send free text
// through this endpoint even via a direct API call, so this list IS the
// entire vocabulary two users can exchange here.
const QUOTE_KEYS = [
  WATCHED_IT,
  'Fool of a Took!',
  'Prestige Worldwide',
  'I miss your whispering eye',
  'Aim for the bushes',
  'Read a f***ing book',
  "I'll be back",
  'Why so serious?',
  "You can't handle the truth!",
  'May the Force be with you',
  "Here's looking at you, kid",
  'You shall not pass!',
  'I am Groot',
  'Say hello to my little friend!',
  'Life is like a box of chocolates',
  'To infinity and beyond!',
  'Nobody puts Baby in a corner',
  'Great Scott!',
  'This was great!',
  'Thank you!',
  'Not for me this one',
] as const;

/** Splits QUOTE_KEYS into fixed-size rows so the sheet reads as multiple
 * scrollable keyboard rows rather than one very long one. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size) as T[]);
  return rows;
}
const QUOTE_ROWS = chunk(QUOTE_KEYS, 7);

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

// ── Reaction "keyboard" — emoji top row + horizontally-scrolling rows of
// movie-catchphrase keys, styled to read as an actual keyboard popup rather
// than a row of chat-style pills. Opens as a bottom sheet from a "React"
// trigger on each film row instead of being permanently inline, since the
// full set (7 emoji + 20 phrases) is too much to show inside every card. ────

function ReactionKeyboardSheet({
  visible,
  filmTitle,
  currentReaction,
  onSelect,
  onClose,
  disabled,
}: {
  visible: boolean;
  filmTitle: string | null;
  currentReaction: string | null | undefined;
  onSelect: (r: ReactNotificationBodyReaction) => void;
  onClose: () => void;
  disabled?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={kStyles.overlay}>
        <TouchableOpacity style={kStyles.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={kStyles.sheet}>
          <View style={kStyles.handle} />

          <View style={kStyles.header}>
            <Text style={kStyles.headerTitle} numberOfLines={1}>
              {filmTitle ? `React to "${filmTitle}"` : 'React'}
            </Text>
            <TouchableOpacity onPress={onClose} style={kStyles.closeBtn} hitSlop={8}>
              <Ionicons name="close" size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* Emoji row — the keyboard's top row */}
          <View style={kStyles.emojiRow}>
            {EMOJI_KEYS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                onPress={() => onSelect(emoji)}
                disabled={disabled}
                activeOpacity={0.6}
                style={kStyles.emojiKey}
              >
                <Text
                  style={[kStyles.emojiText, currentReaction === emoji && kStyles.emojiTextSelected]}
                >
                  {emoji}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Catchphrase "keys" — where the letters would be, one horizontally
              scrolling row per keyboard row */}
          {QUOTE_ROWS.map((row, rowIndex) => (
            <ScrollView
              key={rowIndex}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={kStyles.quoteRow}
            >
              {row.map((phrase) => {
                const selected = currentReaction === phrase;
                const isWatched = phrase === WATCHED_IT;
                return (
                  <TouchableOpacity
                    key={phrase}
                    style={[kStyles.quoteKey, selected && kStyles.quoteKeySelected]}
                    onPress={() => onSelect(phrase)}
                    disabled={disabled}
                    activeOpacity={0.7}
                  >
                    {isWatched && (
                      <Ionicons
                        name="checkmark-circle"
                        size={13}
                        color={selected ? '#FFFFFF' : '#059669'}
                        style={{ marginRight: 4 }}
                      />
                    )}
                    <Text style={[kStyles.quoteText, selected && kStyles.quoteTextSelected]}>
                      {phrase}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const kStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#F1F3F6', // keyboard-body grey, not white
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: Platform.OS === 'ios' ? 30 : 16,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#D1D5DB', alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  headerTitle: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#111827' },
  closeBtn: { padding: 4, marginLeft: 8 },

  // Emoji row — plain glyphs on the grey body, no key background, matching
  // how a real keyboard's emoji/symbol row sits directly on the keyboard.
  emojiRow: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 10,
  },
  emojiKey: { padding: 6, borderRadius: 10 },
  emojiText: { fontSize: 28 },
  emojiTextSelected: { opacity: 0.5 },

  // Catchphrase rows — each phrase gets a white key-cap (unlike single-glyph
  // keys, multi-word phrases need a visible boundary to read as one "key").
  quoteRow: { paddingHorizontal: 8, paddingVertical: 5, gap: 6 },
  quoteKey: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 1,
    elevation: 1,
  },
  quoteKeySelected: { backgroundColor: '#0066FF' },
  quoteText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#111827' },
  quoteTextSelected: { color: '#FFFFFF' },
});

function FilmRow({
  item,
  onOpenReactionSheet,
  onAddToWatchlist,
}: {
  item: FilmNotification;
  onOpenReactionSheet: (item: FilmNotification) => void;
  onAddToWatchlist: (item: FilmNotification) => void;
}) {
  const hasReacted = Boolean(item.reaction);

  return (
    <View style={styles.filmCard}>
      <Image source={{ uri: item.posterUrl }} style={styles.poster} contentFit="cover" transition={200} />
      <View style={styles.filmInfo}>
        <Text style={styles.filmTitle}>{item.filmTitle}</Text>
        <Text style={styles.time}>{formatRelative(new Date(item.createdAt))}</Text>

        <View style={styles.actionRow}>
          {/* Add to Watchlist */}
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => onAddToWatchlist(item)}
            activeOpacity={0.8}
          >
            <Ionicons name="bookmark-outline" size={13} color="#FFF" style={{ marginRight: 4 }} />
            <Text style={styles.addBtnText}>Add to Watchlist</Text>
          </TouchableOpacity>

          {/* Opens the reaction keyboard — shows the current pick, or a prompt */}
          <TouchableOpacity
            style={[styles.reactBtn, hasReacted && styles.reactBtnActive]}
            onPress={() => onOpenReactionSheet(item)}
            activeOpacity={0.8}
          >
            {hasReacted ? (
              <Text style={styles.reactBtnText} numberOfLines={1}>{item.reaction}</Text>
            ) : (
              <>
                <Ionicons name="happy-outline" size={14} color="#6B7280" style={{ marginRight: 4 }} />
                <Text style={styles.reactBtnPromptText}>React</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default function InboxThreadScreen() {
  const { userId, username } = useLocalSearchParams<{ userId: string; username: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [reactingId, setReactingId] = useState<number | null>(null);
  const [reactionTarget, setReactionTarget] = useState<FilmNotification | null>(null);

  const { data, isLoading } = useGetNotificationThread(userId!, {
    query: { queryKey: getGetNotificationThreadQueryKey(userId!), enabled: !!userId },
  });

  const { mutateAsync: reactTo } = useReactToNotification();
  const { mutateAsync: addMovie } = useAddMovie();

  const notifications = data?.notifications ?? [];
  const sender = data?.sender;
  const displayName = sender?.username ?? username ?? 'User';
  const initials = displayName.slice(0, 2).toUpperCase();

  const handleSelectReaction = useCallback(
    async (reaction: ReactNotificationBodyReaction) => {
      if (!reactionTarget) return;
      const id = reactionTarget.id;
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setReactingId(id);
      try {
        await reactTo({ id, data: { reaction } });
        await queryClient.invalidateQueries({ queryKey: getGetNotificationThreadQueryKey(userId!) });
        await queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
        setReactionTarget(null);
      } catch {
        Alert.alert('Error', 'Could not save your reaction.');
      } finally {
        setReactingId(null);
      }
    },
    [reactTo, queryClient, userId, reactionTarget]
  );

  const handleAddToWatchlist = useCallback(
    async (item: FilmNotification) => {
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      try {
        await addMovie({
          data: {
            tmdbId: item.tmdbId,
            title: item.filmTitle,
            releaseYear: '',
            posterUrl: item.posterUrl,
            overview: '',
          },
        });
        await queryClient.invalidateQueries({ queryKey: getListMoviesQueryKey() });
        Alert.alert('Added!', `"${item.filmTitle}" is now in your Watchlist.`);
      } catch (err: any) {
        if (err?.message?.includes('duplicate') || err?.status === 409) {
          Alert.alert('Already saved', `"${item.filmTitle}" is already in your Watchlist.`);
        } else {
          Alert.alert('Error', 'Could not add this film.');
        }
      }
    },
    [addMovie, queryClient]
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color="#111827" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          {sender?.avatarUrl ? (
            <Image source={{ uri: sender.avatarUrl }} style={styles.headerAvatar} contentFit="cover" />
          ) : (
            <View style={[styles.headerAvatar, styles.headerAvatarFallback]}>
              <Text style={styles.headerAvatarText}>{initials}</Text>
            </View>
          )}
          <View>
            <Text style={styles.headerName}>{displayName}</Text>
            <Text style={styles.headerSub}>{notifications.length} recommendation{notifications.length !== 1 ? 's' : ''}</Text>
          </View>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0066FF" />
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <FilmRow
              item={item}
              onOpenReactionSheet={setReactionTarget}
              onAddToWatchlist={handleAddToWatchlist}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="film-outline" size={48} color="#D1D5DB" />
              <Text style={styles.emptyText}>No recommendations from this person yet.</Text>
            </View>
          }
          contentContainerStyle={
            notifications.length === 0
              ? { flex: 1 }
              : { padding: 16, gap: 16, paddingBottom: insets.bottom + 24 }
          }
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#F3F4F6' }} />}
        />
      )}

      <ReactionKeyboardSheet
        visible={reactionTarget !== null}
        filmTitle={reactionTarget?.filmTitle ?? null}
        currentReaction={reactionTarget?.reaction}
        onSelect={handleSelectReaction}
        onClose={() => setReactionTarget(null)}
        disabled={reactingId !== null}
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
  backBtn: { padding: 4, marginRight: 8 },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerAvatar: { width: 38, height: 38, borderRadius: 19 },
  headerAvatarFallback: { backgroundColor: '#E0E7FF', alignItems: 'center', justifyContent: 'center' },
  headerAvatarText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#4F46E5' },
  headerName: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#111827' },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  filmCard: {
    flexDirection: 'row', gap: 14,
    backgroundColor: '#FFF', paddingVertical: 12,
  },
  poster: { width: 80, height: 120, borderRadius: 8, flexShrink: 0 },
  filmInfo: { flex: 1 },
  filmTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#111827', marginBottom: 4 },
  time: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginBottom: 10 },

  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },

  addBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0066FF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
  },
  addBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#FFF' },

  reactBtn: {
    flexDirection: 'row', alignItems: 'center',
    maxWidth: 150,
    backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  reactBtnActive: { backgroundColor: '#EFF6FF', borderColor: '#0066FF' },
  reactBtnPromptText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#6B7280' },
  reactBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#0066FF' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF', textAlign: 'center' },
});
