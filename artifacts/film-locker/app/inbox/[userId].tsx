import React, { useCallback, useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, Platform, ScrollView, Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Swipeable } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import {
  useGetNotificationThread,
  useSendConversationMessage,
  useAddMovie,
  getGetNotificationThreadQueryKey,
  getGetNotificationsQueryKey,
  getListMoviesQueryKey,
  type ConversationFeedItem,
  type ConversationMessageContent,
} from '@workspace/api-client-react';

// Top row — ordered by how likely each is to be someone's go-to reaction to
// a friend's film pick (warm/positive first, niche ones toward the end).
// Scrollable like the phrase rows below, since the personalised reordering
// (last-used floats to the front) means the "front" position changes.
const EMOJI_KEYS = ['❤️', '😂', '😍', '😭', '🤪', '🤓', '🤯', '👍', '🤌', '👎'] as const;
const LAST_EMOJI_STORAGE_KEY = 'film-locker:lastReactionEmoji';

const WATCHED_IT = 'Watched it!';

// "Letter keys" — movie catchphrases (plus a couple of plain conversation
// starters) instead of letters, laid out as horizontally-scrolling keyboard
// rows. Matches the fixed enum enforced server-side by
// SendConversationMessageBody — there's no way to send free text through
// this endpoint even via a direct API call, so this list IS the entire
// vocabulary two users can exchange here. Row membership below (via
// QUOTE_ROWS) is fixed by this array's order; only the position *within*
// a row changes at runtime, when that row's last-used phrase floats to
// its front — see lastQuoteByRow in ComposerPanel.
const QUOTE_KEYS = [
  // Standard conversational phrases first — most likely to be reached for,
  // so they default to the leftmost/first positions in each sheet.
  WATCHED_IT,
  'Have you watched it yet?',
  'What did you think?',
  'This was great!',
  'Not for me this one',
  'Thank you!',
  // Movie catchphrases fill the rest.
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
  'Hey, why you so sweaty?',
  'Watching Cops',
] as const;

/** Splits QUOTE_KEYS into fixed-size rows so the sheet reads as multiple
 * scrollable keyboard rows rather than one very long one. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size) as T[]);
  return rows;
}
const QUOTE_ROWS = chunk(QUOTE_KEYS, 7);
const LAST_QUOTE_STORAGE_KEY = 'film-locker:lastQuoteByRow';

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

// ── Message composer — emoji top row + horizontally-scrolling rows of
// movie-catchphrase keys, styled to read as an actual keyboard popup rather
// than a row of chat-style pills. Rendered inline (not a Modal) inside an
// Animated.View the screen animates open/closed, so — like a real keyboard
// appearing — the chat feed above it shrinks to make room instead of being
// covered, and whatever you're about to send stays visible. Opens either
// from the bottom "Send a message" bar (standalone) or from a specific
// film's React button / swipe-to-reply gesture (targeted — replyTarget set). ──

function ComposerPanel({
  replyTarget,
  onSelect,
  onClose,
  disabled,
  bottomInset,
}: {
  replyTarget: { id: number; filmTitle: string } | null;
  onSelect: (content: ConversationMessageContent) => void;
  onClose: () => void;
  disabled?: boolean;
  bottomInset: number;
}) {
  // Personalisation only — which emoji sits first — so it's a device-local
  // preference, not something worth round-tripping to the server for.
  const [lastEmoji, setLastEmoji] = useState<(typeof EMOJI_KEYS)[number] | null>(null);

  // Same idea for the phrase rows, but kept strictly per-row: the last
  // phrase used within a given row floats to that row's front, without
  // ever pulling it into a different row or reordering rows that weren't
  // touched. Keyed by row index since QUOTE_ROWS/row membership is fixed.
  const [lastQuoteByRow, setLastQuoteByRow] = useState<Record<number, string>>({});

  useEffect(() => {
    AsyncStorage.getItem(LAST_EMOJI_STORAGE_KEY).then((stored) => {
      if (stored && (EMOJI_KEYS as readonly string[]).includes(stored)) {
        setLastEmoji(stored as (typeof EMOJI_KEYS)[number]);
      }
    });
    AsyncStorage.getItem(LAST_QUOTE_STORAGE_KEY).then((stored) => {
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as Record<number, string>;
        setLastQuoteByRow(parsed);
      } catch {
        // Ignore malformed/stale storage — falls back to default row order.
      }
    });
  }, []);

  const orderedEmojis = lastEmoji
    ? [lastEmoji, ...EMOJI_KEYS.filter((e) => e !== lastEmoji)]
    : EMOJI_KEYS;

  const orderedQuoteRows = QUOTE_ROWS.map((row, rowIndex) => {
    const last = lastQuoteByRow[rowIndex];
    if (last && (row as readonly string[]).includes(last)) {
      return [last, ...row.filter((p) => p !== last)];
    }
    return row;
  });

  const handleEmojiPress = useCallback((emoji: (typeof EMOJI_KEYS)[number]) => {
    setLastEmoji(emoji);
    void AsyncStorage.setItem(LAST_EMOJI_STORAGE_KEY, emoji);
    onSelect(emoji);
  }, [onSelect]);

  const handleQuotePress = useCallback((phrase: string, rowIndex: number) => {
    setLastQuoteByRow((prev) => {
      const next = { ...prev, [rowIndex]: phrase };
      void AsyncStorage.setItem(LAST_QUOTE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    onSelect(phrase as ConversationMessageContent);
  }, [onSelect]);

  return (
    <View style={kStyles.sheet}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        bounces={false}
        contentContainerStyle={{ paddingBottom: bottomInset + 12 }}
      >
        <View style={kStyles.header}>
          <Text style={kStyles.headerTitle} numberOfLines={1}>
            {replyTarget ? `Reply to "${replyTarget.filmTitle}"` : 'New message'}
          </Text>
          <TouchableOpacity onPress={onClose} style={kStyles.closeBtn} hitSlop={8}>
            <Ionicons name="close" size={20} color="#6B7280" />
          </TouchableOpacity>
        </View>

        {/* Emoji row — the keyboard's top row. Scrollable, and reordered so
            whichever emoji you used last sits first — easy to get back to
            your go-to reaction without hunting for it. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={kStyles.emojiRow}
        >
          {orderedEmojis.map((emoji) => (
            <TouchableOpacity
              key={emoji}
              onPress={() => handleEmojiPress(emoji)}
              disabled={disabled}
              activeOpacity={0.6}
              style={kStyles.emojiKey}
            >
              <Text style={kStyles.emojiText}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Catchphrase "keys" — where the letters would be, one horizontally
            scrolling row per keyboard row. Each row independently floats
            its own last-used phrase to the front — rows never mix. */}
        {orderedQuoteRows.map((row, rowIndex) => (
          <ScrollView
            key={rowIndex}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={kStyles.quoteRow}
          >
            {row.map((phrase) => {
              const isWatched = phrase === WATCHED_IT;
              return (
                <TouchableOpacity
                  key={phrase}
                  style={kStyles.quoteKey}
                  onPress={() => handleQuotePress(phrase, rowIndex)}
                  disabled={disabled}
                  activeOpacity={0.7}
                >
                  {isWatched && (
                    <Ionicons
                      name="checkmark-circle"
                      size={13}
                      color="#059669"
                      style={{ marginRight: 4 }}
                    />
                  )}
                  <Text style={kStyles.quoteText}>{phrase}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ))}
      </ScrollView>
    </View>
  );
}

const kStyles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: '#F1F3F6', // keyboard-body grey, not white
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
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 10, gap: 14,
  },
  emojiKey: { padding: 6, borderRadius: 10 },
  emojiText: { fontSize: 28 },

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
  quoteText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#111827' },
});

// ── Recommendation card — a film shared in the thread, from either side.
// Wrapped in a Swipeable by the caller so swiping it opens the composer
// targeted at this specific film ("swipe to reply"). The per-film React
// button is the non-gesture alternative that does the same thing. ──

function RecommendationCard({
  item,
  isMine,
  onOpenReply,
  onAddToWatchlist,
}: {
  item: ConversationFeedItem;
  isMine: boolean;
  onOpenReply: (item: ConversationFeedItem) => void;
  onAddToWatchlist: (item: ConversationFeedItem) => void;
}) {
  return (
    <View style={[styles.filmCard, isMine ? styles.filmCardMine : styles.filmCardTheirs]}>
      <Image source={{ uri: item.posterUrl! }} style={styles.poster} contentFit="cover" transition={200} />
      <View style={styles.filmInfo}>
        <Text style={styles.filmMeta}>{isMine ? 'You recommended' : 'Recommended'}</Text>
        <Text style={styles.filmTitle}>{item.filmTitle}</Text>
        <Text style={styles.time}>{formatRelative(new Date(item.createdAt))}</Text>

        <View style={styles.actionRow}>
          {!isMine && (
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => onAddToWatchlist(item)}
              activeOpacity={0.8}
            >
              <Ionicons name="bookmark-outline" size={13} color="#FFF" style={{ marginRight: 4 }} />
              <Text style={styles.addBtnText}>Add to Watchlist</Text>
            </TouchableOpacity>
          )}

          {/* Opens the composer targeted at this film — same result as
              swiping the card. */}
          <TouchableOpacity
            style={styles.reactBtn}
            onPress={() => onOpenReply(item)}
            activeOpacity={0.8}
          >
            <Ionicons name="happy-outline" size={14} color="#6B7280" style={{ marginRight: 4 }} />
            <Text style={styles.reactBtnPromptText}>React</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ── Chat bubble — a reaction/message, right-aligned + blue when sent by the
// viewer, left-aligned + grey otherwise. Shows a quoted reply preview above
// the text when it targets a specific film. ──

function MessageBubble({ item, isMine }: { item: ConversationFeedItem; isMine: boolean }) {
  return (
    <View style={[styles.bubbleRow, isMine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {item.replyToFilmTitle && (
          <View style={styles.replyPreview}>
            <Ionicons name="arrow-undo" size={11} color={isMine ? '#DBEAFE' : '#6B7280'} />
            <Text
              style={[styles.replyPreviewText, isMine && styles.replyPreviewTextMine]}
              numberOfLines={1}
            >
              {item.replyToFilmTitle}
            </Text>
          </View>
        )}
        <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>{item.content}</Text>
      </View>
      <Text style={styles.bubbleTime}>{formatRelative(new Date(item.createdAt))}</Text>
    </View>
  );
}

// ── Wraps a recommendation card so swiping it right opens the composer
// pre-targeted at that film ("swipe to reply"). ──

function SwipeToReplyRow({
  onReply,
  children,
}: {
  onReply: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<Swipeable>(null);

  return (
    <Swipeable
      ref={ref}
      leftThreshold={36}
      overshootLeft={false}
      renderLeftActions={() => (
        <View style={styles.swipeReplyHint}>
          <Ionicons name="arrow-undo" size={20} color="#0066FF" />
        </View>
      )}
      onSwipeableWillOpen={() => {
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onReply();
        ref.current?.close();
      }}
    >
      {children}
    </Swipeable>
  );
}

export default function InboxThreadScreen() {
  const { userId, username } = useLocalSearchParams<{ userId: string; username: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId: myClerkId } = useAuth();

  const [sending, setSending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<{ id: number; filmTitle: string } | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  // Animates the panel's height open/closed, like a real keyboard sliding
  // up — the chat feed above it (flex: 1) shrinks to make room rather than
  // the panel covering it, so whatever's being sent stays visible.
  const composerHeight = useRef(new Animated.Value(0)).current;
  const COMPOSER_OPEN_HEIGHT = 300;

  useEffect(() => {
    Animated.timing(composerHeight, {
      toValue: composerOpen ? COMPOSER_OPEN_HEIGHT + insets.bottom : 0,
      duration: 220,
      useNativeDriver: false, // height isn't supported by the native driver
    }).start();
  }, [composerOpen, insets.bottom, composerHeight]);

  const { data, isLoading } = useGetNotificationThread(userId!, {
    query: { queryKey: getGetNotificationThreadQueryKey(userId!), enabled: !!userId },
  });

  // Loading this thread marks its messages/recommendations as read on the
  // server as a side effect — refresh the bell-badge query once so the
  // unread count clears immediately instead of waiting for its next poll.
  const readInvalidatedRef = useRef(false);
  useEffect(() => {
    if (!data || readInvalidatedRef.current) return;
    readInvalidatedRef.current = true;
    void queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
  }, [data, queryClient]);

  const { mutateAsync: sendMessage } = useSendConversationMessage();
  const { mutateAsync: addMovie } = useAddMovie();

  const feed = data?.feed ?? [];
  const feedDesc = [...feed].reverse(); // inverted FlatList wants newest-first
  const sender = data?.sender;
  const displayName = sender?.username ?? username ?? 'User';
  const initials = (sender?.displayInitials || displayName).slice(0, 5).toUpperCase();
  const recommendationCount = feed.filter((f) => f.type === 'recommendation').length;

  const openReplyTo = useCallback((item: ConversationFeedItem) => {
    setReplyTarget({ id: item.id, filmTitle: item.filmTitle ?? '' });
    setComposerOpen(true);
  }, []);

  const openStandalone = useCallback(() => {
    setReplyTarget(null);
    setComposerOpen(true);
  }, []);

  const handleSelect = useCallback(
    async (content: ConversationMessageContent) => {
      if (!userId) return;
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSending(true);
      try {
        await sendMessage({
          userId,
          data: { content, replyToNotificationId: replyTarget?.id ?? null },
        });
        await queryClient.invalidateQueries({ queryKey: getGetNotificationThreadQueryKey(userId) });
        await queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
        setComposerOpen(false);
        setReplyTarget(null);
      } catch {
        Alert.alert('Error', 'Could not send that.');
      } finally {
        setSending(false);
      }
    },
    [sendMessage, queryClient, userId, replyTarget]
  );

  const handleAddToWatchlist = useCallback(
    async (item: ConversationFeedItem) => {
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      try {
        await addMovie({
          data: {
            tmdbId: item.tmdbId!,
            title: item.filmTitle!,
            releaseYear: '',
            posterUrl: item.posterUrl!,
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
              <Text style={styles.headerAvatarText} numberOfLines={1} adjustsFontSizeToFit>{initials}</Text>
            </View>
          )}
          <View>
            <Text style={styles.headerName}>{displayName}</Text>
            <Text style={styles.headerSub}>{recommendationCount} recommendation{recommendationCount !== 1 ? 's' : ''}</Text>
          </View>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0066FF" />
        </View>
      ) : (
        <FlatList
          data={feedDesc}
          inverted
          keyExtractor={(item) => `${item.type}-${item.id}`}
          renderItem={({ item }) => {
            const isMine = item.fromUserId === myClerkId;
            if (item.type === 'recommendation') {
              return (
                <SwipeToReplyRow onReply={() => openReplyTo(item)}>
                  <RecommendationCard
                    item={item}
                    isMine={isMine}
                    onOpenReply={openReplyTo}
                    onAddToWatchlist={handleAddToWatchlist}
                  />
                </SwipeToReplyRow>
              );
            }
            return <MessageBubble item={item} isMine={isMine} />;
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="film-outline" size={48} color="#D1D5DB" />
              <Text style={styles.emptyText}>No messages with this person yet. Say hi below.</Text>
            </View>
          }
          contentContainerStyle={
            feedDesc.length === 0
              ? { flex: 1 }
              : { padding: 16, gap: 12 }
          }
        />
      )}

      {/* Standalone composer bar — lets either person send a canned
          message even when no recommendation exists between them yet. */}
      <View style={[styles.composerBar, { paddingBottom: composerOpen ? 10 : insets.bottom + 10 }]}>
        <TouchableOpacity style={styles.composerBtn} onPress={openStandalone} activeOpacity={0.8}>
          <Ionicons name="happy-outline" size={16} color="#6B7280" style={{ marginRight: 8 }} />
          <Text style={styles.composerBtnText}>Send a message…</Text>
        </TouchableOpacity>
      </View>

      {/* Grows open beneath the bar, pushing the chat feed above it up —
          the "keyboard" panel itself. */}
      <Animated.View style={{ height: composerHeight, overflow: 'hidden' }}>
        <ComposerPanel
          replyTarget={replyTarget}
          onSelect={handleSelect}
          onClose={() => { setComposerOpen(false); setReplyTarget(null); }}
          disabled={sending}
          bottomInset={insets.bottom}
        />
      </Animated.View>
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
  headerAvatarText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#4F46E5' },
  headerName: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#111827' },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  filmCard: {
    flexDirection: 'row', gap: 14,
    backgroundColor: '#FFF', paddingVertical: 12,
    maxWidth: '85%',
  },
  filmCardMine: { alignSelf: 'flex-end' },
  filmCardTheirs: { alignSelf: 'flex-start' },
  poster: { width: 80, height: 120, borderRadius: 8, flexShrink: 0 },
  filmInfo: { flex: 1 },
  filmMeta: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
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
    backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  reactBtnPromptText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#6B7280' },

  swipeReplyHint: {
    width: 64, alignItems: 'center', justifyContent: 'center',
  },

  bubbleRow: { maxWidth: '78%' },
  bubbleRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleRowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  bubbleMine: { backgroundColor: '#0066FF', borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: '#F1F3F6', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#111827' },
  bubbleTextMine: { color: '#FFFFFF' },
  bubbleTime: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginTop: 3, marginHorizontal: 4 },

  replyPreview: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginBottom: 4, opacity: 0.85,
  },
  replyPreviewText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: '#6B7280', flexShrink: 1 },
  replyPreviewTextMine: { color: '#DBEAFE' },

  composerBar: {
    paddingHorizontal: 16, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  composerBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10,
  },
  composerBtnText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, transform: [{ scaleY: -1 }] },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF', textAlign: 'center' },
});
