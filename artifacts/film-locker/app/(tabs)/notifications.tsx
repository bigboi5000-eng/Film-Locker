import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  useGetNotifications,
  useMarkNotificationRead,
  useAddMovie,
  getGetNotificationsQueryKey,
  getListMoviesQueryKey,
  type FilmNotification,
} from '@workspace/api-client-react';
import { Platform } from 'react-native';

function formatRelative(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

// ── Notification item ─────────────────────────────────────────────────────────

function NotificationItem({
  item,
  onMarkRead,
  onAddToWatchlist,
}: {
  item: FilmNotification;
  onMarkRead: (id: number) => void;
  onAddToWatchlist: (item: FilmNotification) => void;
}) {
  const senderName = item.fromUsername ?? 'Someone';
  const initials = senderName.slice(0, 2).toUpperCase();
  const timeAgo = formatRelative(new Date(item.createdAt));

  return (
    <TouchableOpacity
      style={[styles.item, !item.isRead && styles.itemUnread]}
      onPress={() => !item.isRead && onMarkRead(item.id)}
      activeOpacity={0.75}
    >
      {/* Unread dot */}
      {!item.isRead && <View style={styles.unreadDot} />}

      {/* Sender avatar */}
      <View style={styles.avatarWrap}>
        {item.fromAvatarUrl ? (
          <Image
            source={{ uri: item.fromAvatarUrl }}
            style={styles.avatar}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        )}
        {/* Envelope badge on avatar */}
        <View style={styles.avatarBadge}>
          <Ionicons name="mail" size={10} color="#FFFFFF" />
        </View>
      </View>

      {/* Message + poster */}
      <View style={styles.body}>
        <Text style={styles.message}>
          <Text style={styles.senderName}>{senderName}</Text>
          {' thinks you should watch '}
          <Text style={styles.filmTitle}>{item.filmTitle}</Text>
        </Text>
        <Text style={styles.time}>{timeAgo}</Text>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => onAddToWatchlist(item)}
            activeOpacity={0.8}
          >
            <Ionicons name="bookmark-outline" size={14} color="#FFFFFF" style={{ marginRight: 5 }} />
            <Text style={styles.addBtnText}>Add to Watchlist</Text>
          </TouchableOpacity>

          {!item.isRead && (
            <TouchableOpacity
              style={styles.dismissBtn}
              onPress={() => onMarkRead(item.id)}
              activeOpacity={0.8}
            >
              <Text style={styles.dismissBtnText}>Dismiss</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Poster thumbnail */}
      <Image
        source={{ uri: item.posterUrl }}
        style={styles.poster}
        contentFit="cover"
        transition={200}
      />
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch, isRefetching } = useGetNotifications();
  const { mutateAsync: markRead } = useMarkNotificationRead();
  const { mutateAsync: addMovie } = useAddMovie();

  const invalidateNotifications = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
  }, [queryClient]);

  const handleMarkRead = useCallback(
    async (id: number) => {
      try {
        await markRead({ id });
        await invalidateNotifications();
      } catch {
        Alert.alert('Error', 'Could not mark notification as read.');
      }
    },
    [markRead, invalidateNotifications]
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
        // Mark as read after acting on it
        if (!item.isRead) {
          await markRead({ id: item.id });
          await invalidateNotifications();
        }
        Alert.alert('Added!', `"${item.filmTitle}" has been added to your Watchlist.`);
      } catch (err: any) {
        if (err?.message?.includes('duplicate') || err?.status === 409) {
          Alert.alert('Already saved', `"${item.filmTitle}" is already in your Watchlist.`);
        } else {
          Alert.alert('Error', 'Could not add this film to your Watchlist.');
        }
      }
    },
    [addMovie, queryClient, markRead, invalidateNotifications]
  );

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Notifications</Text>
        {unreadCount > 0 && (
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{unreadCount} new</Text>
          </View>
        )}
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
            <NotificationItem
              item={item}
              onMarkRead={handleMarkRead}
              onAddToWatchlist={handleAddToWatchlist}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="mail-open-outline" size={56} color="#D1D5DB" />
              <Text style={styles.emptyTitle}>No recommendations yet</Text>
              <Text style={styles.emptySubtitle}>
                When friends recommend films to you, they'll appear here.
              </Text>
            </View>
          }
          contentContainerStyle={notifications.length === 0 ? { flex: 1 } : { paddingBottom: insets.bottom + 16 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor="#0066FF"
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#111827',
    flex: 1,
  },
  headerBadge: {
    backgroundColor: '#0066FF',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  headerBadgeText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFFFFF',
  },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    backgroundColor: '#FFFFFF',
    position: 'relative',
  },
  itemUnread: {
    backgroundColor: '#EFF6FF',
  },
  unreadDot: {
    position: 'absolute',
    top: 20,
    left: 4,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#0066FF',
  },

  avatarWrap: { position: 'relative', marginRight: 12, flexShrink: 0 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: {
    backgroundColor: '#E0E7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#4F46E5' },
  avatarBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },

  body: { flex: 1, marginRight: 12 },
  message: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#374151',
    lineHeight: 20,
    marginBottom: 4,
  },
  senderName: { fontFamily: 'Inter_600SemiBold', color: '#111827' },
  filmTitle: { fontFamily: 'Inter_600SemiBold', color: '#0066FF' },
  time: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
    marginBottom: 10,
  },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0066FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addBtnText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFFFFF',
  },
  dismissBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  dismissBtnText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#6B7280',
  },

  poster: {
    width: 52,
    height: 78,
    borderRadius: 6,
    flexShrink: 0,
  },

  separator: { height: 1, backgroundColor: '#F3F4F6', marginLeft: 72 },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: '#374151',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
  },
});
