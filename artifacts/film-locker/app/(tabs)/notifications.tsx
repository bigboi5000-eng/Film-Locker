import React, { useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  useGetNotifications,
  type FilmNotification,
} from '@workspace/api-client-react';

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString();
}

interface ConversationGroup {
  fromUserId: string;
  fromUsername: string | null;
  fromAvatarUrl: string | null;
  latest: FilmNotification;
  allPosters: string[];
  unreadCount: number;
  latestAt: Date;
}

function groupNotifications(notifications: FilmNotification[]): ConversationGroup[] {
  const map = new Map<string, ConversationGroup>();
  for (const n of notifications) {
    const existing = map.get(n.fromUserId);
    if (existing) {
      existing.unreadCount += n.isRead ? 0 : 1;
      existing.allPosters.push(n.posterUrl);
      if (new Date(n.createdAt) > existing.latestAt) {
        existing.latest = n;
        existing.latestAt = new Date(n.createdAt);
      }
    } else {
      map.set(n.fromUserId, {
        fromUserId: n.fromUserId,
        fromUsername: n.fromUsername ?? null,
        fromAvatarUrl: n.fromAvatarUrl ?? null,
        latest: n,
        allPosters: [n.posterUrl],
        unreadCount: n.isRead ? 0 : 1,
        latestAt: new Date(n.createdAt),
      });
    }
  }
  return [...map.values()].sort((a, b) => b.latestAt.getTime() - a.latestAt.getTime());
}

function ConversationRow({ group, onPress }: { group: ConversationGroup; onPress: () => void }) {
  const initials = (group.fromUsername ?? '?').slice(0, 2).toUpperCase();
  const previews = group.allPosters.slice(0, 3);

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.75}>
      {/* Avatar */}
      <View style={styles.avatarWrap}>
        {group.fromAvatarUrl ? (
          <Image source={{ uri: group.fromAvatarUrl }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        )}
        {group.unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>{group.unreadCount > 9 ? '9+' : group.unreadCount}</Text>
          </View>
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.contentHeader}>
          <Text style={[styles.username, group.unreadCount > 0 && styles.usernameUnread]}>
            {group.fromUsername ?? 'Unknown'}
          </Text>
          <Text style={styles.time}>{formatRelative(group.latestAt)}</Text>
        </View>
        <Text style={styles.preview} numberOfLines={1}>
          🎬 {group.latest.filmTitle}
          {group.allPosters.length > 1 ? ` +${group.allPosters.length - 1} more` : ''}
        </Text>
      </View>

      {/* Poster stack preview */}
      <View style={styles.posterStack}>
        {previews.slice(0, 3).map((uri, i) => (
          <Image
            key={i}
            source={{ uri }}
            style={[styles.previewPoster, { right: i * 16, zIndex: 3 - i }]}
            contentFit="cover"
          />
        ))}
      </View>

      <Ionicons name="chevron-forward" size={16} color="#D1D5DB" style={{ marginLeft: 4 }} />
    </TouchableOpacity>
  );
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, isLoading, refetch, isRefetching } = useGetNotifications();

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  const groups = useMemo(() => groupNotifications(notifications), [notifications]);

  const handleOpenThread = useCallback(
    (group: ConversationGroup) => {
      router.push({
        pathname: '/inbox/[userId]',
        params: { userId: group.fromUserId, username: group.fromUsername ?? '' },
      });
    },
    [router]
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Inbox</Text>
          {unreadCount > 0 && (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          style={styles.peopleBtn}
          onPress={() => router.push('/people')}
          activeOpacity={0.75}
        >
          <Ionicons name="people-outline" size={18} color="#0066FF" />
          <Text style={styles.peopleBtnText}>Find People</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0066FF" />
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.fromUserId}
          renderItem={({ item }) => (
            <ConversationRow group={item} onPress={() => handleOpenThread(item)} />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="mail-open-outline" size={56} color="#D1D5DB" />
              <Text style={styles.emptyTitle}>No recommendations yet</Text>
              <Text style={styles.emptySub}>
                Follow people and they can recommend films directly to you.
              </Text>
              <TouchableOpacity
                style={styles.findBtn}
                onPress={() => router.push('/people')}
                activeOpacity={0.8}
              >
                <Ionicons name="people-outline" size={16} color="#FFF" />
                <Text style={styles.findBtnText}>Find People</Text>
              </TouchableOpacity>
            </View>
          }
          contentContainerStyle={groups.length === 0 ? { flex: 1 } : { paddingBottom: insets.bottom + 16 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#0066FF" />
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#111827' },
  headerBadge: {
    backgroundColor: '#0066FF', borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  headerBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#FFF' },
  peopleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#EFF6FF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
  },
  peopleBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#0066FF' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#FFF',
  },
  avatarWrap: { position: 'relative', marginRight: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: { backgroundColor: '#E0E7FF', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#4F46E5' },
  unreadBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: '#0066FF', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4, borderWidth: 2, borderColor: '#FFF',
  },
  unreadBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#FFF' },

  content: { flex: 1 },
  contentHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  username: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#374151' },
  usernameUnread: { fontFamily: 'Inter_700Bold', color: '#111827' },
  time: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },
  preview: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#6B7280' },

  posterStack: { position: 'relative', width: 60, height: 52, marginLeft: 8, marginRight: 4 },
  previewPoster: {
    position: 'absolute', width: 36, height: 52,
    borderRadius: 4, borderWidth: 1.5, borderColor: '#FFF',
  },

  separator: { height: 1, backgroundColor: '#F3F4F6', marginLeft: 76 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: '#374151', textAlign: 'center' },
  emptySub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },
  findBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#0066FF', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, marginTop: 4,
  },
  findBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
});
