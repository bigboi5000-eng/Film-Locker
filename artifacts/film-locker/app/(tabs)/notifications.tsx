import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetNotifications,
  useGetFollows,
  useAcceptFollowRequest,
  useDeclineFollowRequest,
  useUnfollowUser,
  getGetFollowsQueryKey,
  getGetNotificationUsersQueryKey,
  type FilmNotification,
  type PublicUserProfile,
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
  fromDisplayInitials: string | null;
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
        fromDisplayInitials: n.fromDisplayInitials ?? null,
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
  const router = useRouter();
  const initials = (group.fromDisplayInitials || group.fromUsername || '?').slice(0, 5).toUpperCase();
  const previews = group.allPosters.slice(0, 3);

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.75}>
      {/* Avatar — tapping this opens the profile instead of the thread */}
      <TouchableOpacity
        style={styles.avatarWrap}
        onPress={() => router.push(`/user/${group.fromUserId}`)}
        activeOpacity={0.7}
      >
        {group.fromAvatarUrl ? (
          <Image source={{ uri: group.fromAvatarUrl }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarText} numberOfLines={1} adjustsFontSizeToFit>{initials}</Text>
          </View>
        )}
        {group.unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>{group.unreadCount > 9 ? '9+' : group.unreadCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.contentHeader}>
          <Text style={[styles.username, group.unreadCount > 0 && styles.usernameUnread]} numberOfLines={1}>
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

// ── Film Pals — people you follow and who follow you back, plus incoming and
// outgoing follow requests. Lives as a second tab on this screen since it's
// the same "people I have a relationship with" surface as the inbox. ──

function PalAvatar({ user, onPress }: { user: PublicUserProfile; onPress?: () => void }) {
  const initials = (user.displayInitials || user.username || '?').slice(0, 5).toUpperCase();
  const avatar = user.avatarUrl ? (
    <Image source={{ uri: user.avatarUrl }} style={styles.avatar} contentFit="cover" />
  ) : (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Text style={styles.avatarText} numberOfLines={1} adjustsFontSizeToFit>{initials}</Text>
    </View>
  );
  return onPress ? (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{avatar}</TouchableOpacity>
  ) : avatar;
}

function FilmPalsView() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch, isRefetching } = useGetFollows();
  const { mutateAsync: acceptRequest } = useAcceptFollowRequest();
  const { mutateAsync: declineRequest } = useDeclineFollowRequest();
  const { mutateAsync: unfollowUser } = useUnfollowUser();
  const [busyId, setBusyId] = useState<string | null>(null);

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: getGetFollowsQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getGetNotificationUsersQueryKey() });
  }, [queryClient]);

  const incomingRequests = data?.incomingRequests ?? [];
  const outgoingRequests = data?.outgoingRequests ?? [];
  const following = data?.following ?? [];
  const followerIds = new Set((data?.followers ?? []).map((u) => u.clerkId));
  const filmPals = following.filter((u) => followerIds.has(u.clerkId));

  const handleAccept = useCallback(async (user: PublicUserProfile) => {
    setBusyId(user.clerkId);
    try {
      await acceptRequest({ userId: user.clerkId });
      await invalidate();
    } catch {
      Alert.alert('Error', 'Could not accept this request.');
    } finally {
      setBusyId(null);
    }
  }, [acceptRequest, invalidate]);

  const handleDecline = useCallback(async (user: PublicUserProfile) => {
    setBusyId(user.clerkId);
    try {
      await declineRequest({ userId: user.clerkId });
      await invalidate();
    } catch {
      Alert.alert('Error', 'Could not decline this request.');
    } finally {
      setBusyId(null);
    }
  }, [declineRequest, invalidate]);

  const handleCancel = useCallback(async (user: PublicUserProfile) => {
    setBusyId(user.clerkId);
    try {
      await unfollowUser({ userId: user.clerkId });
      await invalidate();
    } catch {
      Alert.alert('Error', 'Could not cancel this request.');
    } finally {
      setBusyId(null);
    }
  }, [unfollowUser, invalidate]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0066FF" />
      </View>
    );
  }

  const isEmpty = incomingRequests.length === 0 && outgoingRequests.length === 0 && filmPals.length === 0;

  return (
    <FlatList
      data={[]}
      renderItem={null}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#0066FF" />}
      contentContainerStyle={isEmpty ? { flex: 1 } : { paddingBottom: 24 }}
      ListHeaderComponent={
        <>
          {incomingRequests.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Requests ({incomingRequests.length})</Text>
              {incomingRequests.map((u) => (
                <View key={u.clerkId} style={styles.palRow}>
                  <PalAvatar user={u} onPress={() => router.push(`/user/${u.clerkId}`)} />
                  <Text style={styles.palName} numberOfLines={1}>{u.username ?? 'Unnamed user'}</Text>
                  {busyId === u.clerkId ? (
                    <ActivityIndicator size="small" color="#0066FF" />
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity style={styles.declineBtn} onPress={() => handleDecline(u)} activeOpacity={0.8}>
                        <Text style={styles.declineBtnText}>Decline</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.acceptBtn} onPress={() => handleAccept(u)} activeOpacity={0.8}>
                        <Text style={styles.acceptBtnText}>Accept</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          {outgoingRequests.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Sent ({outgoingRequests.length})</Text>
              {outgoingRequests.map((u) => (
                <View key={u.clerkId} style={styles.palRow}>
                  <PalAvatar user={u} onPress={() => router.push(`/user/${u.clerkId}`)} />
                  <Text style={styles.palName} numberOfLines={1}>{u.username ?? 'Unnamed user'}</Text>
                  {busyId === u.clerkId ? (
                    <ActivityIndicator size="small" color="#0066FF" />
                  ) : (
                    <TouchableOpacity style={styles.pendingBtn} onPress={() => handleCancel(u)} activeOpacity={0.8}>
                      <Text style={styles.pendingBtnText}>Requested</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Film Pals{filmPals.length > 0 ? ` (${filmPals.length})` : ''}
            </Text>
            {filmPals.length === 0 ? (
              <Text style={styles.emptyText}>
                Film Pals are people you follow who follow you back. Follow someone from Find People to get started.
              </Text>
            ) : (
              filmPals.map((u) => (
                <TouchableOpacity
                  key={u.clerkId}
                  style={styles.palRow}
                  activeOpacity={0.75}
                  onPress={() => router.push({ pathname: '/inbox/[userId]', params: { userId: u.clerkId, username: u.username ?? '' } })}
                >
                  <PalAvatar user={u} onPress={() => router.push(`/user/${u.clerkId}`)} />
                  <Text style={styles.palName} numberOfLines={1}>{u.username ?? 'Unnamed user'}</Text>
                  <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
                </TouchableOpacity>
              ))
            )}
          </View>
        </>
      }
      ListEmptyComponent={null}
    />
  );
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'inbox' | 'filmPals'>('inbox');
  const { data, isLoading, refetch, isRefetching } = useGetNotifications();
  const { data: followsData } = useGetFollows();
  const incomingRequestCount = followsData?.incomingRequests?.length ?? 0;

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

      {/* Tab switcher */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'inbox' && styles.tabBtnActive]}
          onPress={() => setActiveTab('inbox')}
          activeOpacity={0.75}
        >
          <Text style={[styles.tabBtnText, activeTab === 'inbox' && styles.tabBtnTextActive]}>Notifications</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'filmPals' && styles.tabBtnActive]}
          onPress={() => setActiveTab('filmPals')}
          activeOpacity={0.75}
        >
          <Text style={[styles.tabBtnText, activeTab === 'filmPals' && styles.tabBtnTextActive]}>Film Pals</Text>
          {incomingRequestCount > 0 && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>{incomingRequestCount > 9 ? '9+' : incomingRequestCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {activeTab === 'filmPals' ? (
        <FilmPalsView />
      ) : isLoading ? (
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

  tabBar: {
    flexDirection: 'row', paddingHorizontal: 20, paddingTop: 12, gap: 8,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  tabBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 4, paddingBottom: 10,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabBtnActive: { borderBottomColor: '#0066FF' },
  tabBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#9CA3AF' },
  tabBtnTextActive: { color: '#0066FF' },
  tabBadge: {
    backgroundColor: '#EF4444', borderRadius: 9, minWidth: 18, height: 18,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  tabBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#FFF' },

  section: { paddingHorizontal: 16, paddingTop: 20 },
  sectionTitle: {
    fontSize: 13, fontFamily: 'Inter_600SemiBold',
    color: '#9CA3AF', letterSpacing: 0.5, textTransform: 'uppercase',
    marginBottom: 8,
  },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF', lineHeight: 20 },

  palRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  palName: { flex: 1, fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#111827' },
  acceptBtn: {
    backgroundColor: '#0066FF', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  acceptBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  declineBtn: {
    backgroundColor: '#F3F4F6', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  declineBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#374151' },
  pendingBtn: {
    backgroundColor: '#F3F4F6', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  pendingBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#374151' },

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
