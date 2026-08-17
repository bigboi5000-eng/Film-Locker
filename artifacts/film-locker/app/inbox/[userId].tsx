import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, Platform,
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

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎬', '🤩'] as const;
const WATCHED_IT = 'Watched it!';
// Canned follow-up responses — kept separate from WATCHED_IT since that's a
// status marker, these are a reply to the recommender. Matches the fixed
// enum enforced server-side by ReactToNotificationBody; there's no way to
// send free text through this endpoint even via a direct API call.
const RESPONSE_PHRASES = ['This was great!', 'Thank you!', 'Not for me this one'] as const;

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

function ReactionBar({
  notificationId,
  currentReaction,
  onReact,
  disabled,
}: {
  notificationId: number;
  currentReaction: string | null | undefined;
  onReact: (id: number, r: ReactNotificationBodyReaction) => void;
  disabled?: boolean;
}) {
  return (
    <View style={rStyles.row}>
      {QUICK_REACTIONS.map((emoji) => {
        const selected = currentReaction === emoji;
        return (
          <TouchableOpacity
            key={emoji}
            style={[rStyles.pill, selected && rStyles.pillSelected]}
            onPress={() => onReact(notificationId, emoji)}
            disabled={disabled}
            activeOpacity={0.7}
          >
            <Text style={rStyles.emoji}>{emoji}</Text>
          </TouchableOpacity>
        );
      })}
      <TouchableOpacity
        style={[rStyles.watchedPill, currentReaction === WATCHED_IT && rStyles.watchedPillSelected]}
        onPress={() => onReact(notificationId, WATCHED_IT)}
        disabled={disabled}
        activeOpacity={0.7}
      >
        <Ionicons
          name="checkmark-circle"
          size={13}
          color={currentReaction === WATCHED_IT ? '#FFFFFF' : '#059669'}
          style={{ marginRight: 3 }}
        />
        <Text style={[rStyles.watchedText, currentReaction === WATCHED_IT && rStyles.watchedTextSelected]}>
          Watched it!
        </Text>
      </TouchableOpacity>
      {RESPONSE_PHRASES.map((phrase) => {
        const selected = currentReaction === phrase;
        return (
          <TouchableOpacity
            key={phrase}
            style={[rStyles.pill, selected && rStyles.pillSelected]}
            onPress={() => onReact(notificationId, phrase)}
            disabled={disabled}
            activeOpacity={0.7}
          >
            <Text style={[rStyles.phraseText, selected && rStyles.phraseTextSelected]}>
              {phrase}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const rStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  pill: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20,
    backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB',
  },
  pillSelected: { backgroundColor: '#EFF6FF', borderColor: '#0066FF' },
  emoji: { fontSize: 16 },
  phraseText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: '#374151' },
  phraseTextSelected: { color: '#0066FF' },
  watchedPill: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
    backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0',
  },
  watchedPillSelected: { backgroundColor: '#059669', borderColor: '#059669' },
  watchedText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#059669' },
  watchedTextSelected: { color: '#FFFFFF' },
});

function FilmRow({
  item,
  onReact,
  onAddToWatchlist,
  reactingId,
}: {
  item: FilmNotification;
  onReact: (id: number, reaction: ReactNotificationBodyReaction) => void;
  onAddToWatchlist: (item: FilmNotification) => void;
  reactingId: number | null;
}) {
  return (
    <View style={styles.filmCard}>
      <Image source={{ uri: item.posterUrl }} style={styles.poster} contentFit="cover" transition={200} />
      <View style={styles.filmInfo}>
        <Text style={styles.filmTitle}>{item.filmTitle}</Text>
        <Text style={styles.time}>{formatRelative(new Date(item.createdAt))}</Text>

        {/* Add to Watchlist */}
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => onAddToWatchlist(item)}
          activeOpacity={0.8}
        >
          <Ionicons name="bookmark-outline" size={13} color="#FFF" style={{ marginRight: 4 }} />
          <Text style={styles.addBtnText}>Add to Watchlist</Text>
        </TouchableOpacity>

        {/* Reactions */}
        <ReactionBar
          notificationId={item.id}
          currentReaction={item.reaction}
          onReact={onReact}
          disabled={reactingId === item.id}
        />
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

  const { data, isLoading } = useGetNotificationThread(userId!, {
    query: { queryKey: getGetNotificationThreadQueryKey(userId!), enabled: !!userId },
  });

  const { mutateAsync: reactTo } = useReactToNotification();
  const { mutateAsync: addMovie } = useAddMovie();

  const notifications = data?.notifications ?? [];
  const sender = data?.sender;
  const displayName = sender?.username ?? username ?? 'User';
  const initials = displayName.slice(0, 2).toUpperCase();

  const handleReact = useCallback(
    async (id: number, reaction: ReactNotificationBodyReaction) => {
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setReactingId(id);
      try {
        await reactTo({ id, data: { reaction } });
        await queryClient.invalidateQueries({ queryKey: getGetNotificationThreadQueryKey(userId!) });
        await queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
      } catch {
        Alert.alert('Error', 'Could not save your reaction.');
      } finally {
        setReactingId(null);
      }
    },
    [reactTo, queryClient, userId]
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
              onReact={handleReact}
              onAddToWatchlist={handleAddToWatchlist}
              reactingId={reactingId}
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

  addBtn: {
    flexDirection: 'row', alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#0066FF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
  },
  addBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#FFF' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF', textAlign: 'center' },
});
