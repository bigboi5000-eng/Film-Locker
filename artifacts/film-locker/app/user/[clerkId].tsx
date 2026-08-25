import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, FlatList, Alert } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetUserProfile,
  getGetUserProfileQueryKey,
  useFollowUser,
  useUnfollowUser,
  getGetFollowsQueryKey,
  getGetNotificationUsersQueryKey,
} from '@workspace/api-client-react';
import { PlaylistCard } from '@/components/PlaylistCard';

export default function UserProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { clerkId } = useLocalSearchParams<{ clerkId: string }>();

  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useGetUserProfile(clerkId, {
    query: { queryKey: getGetUserProfileQueryKey(clerkId), enabled: Boolean(clerkId) },
  });
  const { mutateAsync: followUser } = useFollowUser();
  const { mutateAsync: unfollowUser } = useUnfollowUser();

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetUserProfileQueryKey(clerkId) }),
      queryClient.invalidateQueries({ queryKey: getGetFollowsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetNotificationUsersQueryKey() }),
    ]);
  }, [queryClient, clerkId]);

  const handleFollow = useCallback(async () => {
    setBusy(true);
    try {
      await followUser({ data: { followeeId: clerkId } });
      await invalidate();
    } catch {
      Alert.alert('Error', 'Could not follow this user.');
    } finally {
      setBusy(false);
    }
  }, [followUser, invalidate, clerkId]);

  const handleUnfollow = useCallback(async () => {
    setBusy(true);
    try {
      await unfollowUser({ userId: clerkId });
      await invalidate();
    } catch {
      Alert.alert('Error', 'Could not unfollow this user.');
    } finally {
      setBusy(false);
    }
  }, [unfollowUser, invalidate, clerkId]);

  if (isLoading || !data) {
    return (
      <View style={[styles.root, styles.centerFill, { paddingTop: insets.top }]}>
        {isLoading ? (
          <ActivityIndicator color="#0066FF" size="large" />
        ) : (
          <>
            <Ionicons name="person-outline" size={40} color="#D1D5DB" />
            <Text style={styles.notFoundText}>User not found</Text>
          </>
        )}
        <TouchableOpacity onPress={() => router.back()} style={styles.backLink} activeOpacity={0.7}>
          <Text style={styles.backLinkText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { user, followStatus, stats, publicPlaylists } = data;
  const initials = (user.displayInitials || user.username || '??').slice(0, 5).toUpperCase();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{user.username ?? 'Profile'}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>
        {/* Identity */}
        <View style={styles.identity}>
          {user.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarText} numberOfLines={1} adjustsFontSizeToFit>{initials}</Text>
            </View>
          )}
          <View style={styles.usernameRow}>
            <Text style={styles.username}>{user.username ?? 'Unnamed user'}</Text>
            {user.isPrivate && <Ionicons name="lock-closed" size={14} color="#9CA3AF" style={{ marginLeft: 6 }} />}
          </View>

          {followStatus !== 'self' && (
            busy ? (
              <ActivityIndicator color="#0066FF" style={{ marginTop: 14 }} />
            ) : followStatus === 'accepted' ? (
              <TouchableOpacity style={[styles.followBtn, styles.followingBtn]} onPress={handleUnfollow} activeOpacity={0.8}>
                <Text style={styles.followingBtnText}>Following</Text>
              </TouchableOpacity>
            ) : followStatus === 'pending' ? (
              <TouchableOpacity style={[styles.followBtn, styles.followingBtn]} onPress={handleUnfollow} activeOpacity={0.8}>
                <Text style={styles.followingBtnText}>Requested</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.followBtn} onPress={handleFollow} activeOpacity={0.8}>
                <Text style={styles.followBtnText}>{user.isPrivate ? 'Request' : 'Follow'}</Text>
              </TouchableOpacity>
            )
          )}
        </View>

        {/* Headline stats */}
        <View style={styles.statsRow}>
          <View style={styles.statTile}>
            <Text style={styles.statValue}>{stats.watchedCount}</Text>
            <Text style={styles.statLabel}>Watched</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statTile}>
            <Text style={styles.statValue}>{stats.reviewCount}</Text>
            <Text style={styles.statLabel}>Reviews</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statTile}>
            <Text style={styles.statValue}>{stats.publicPlaylistCount}</Text>
            <Text style={styles.statLabel}>Playlists</Text>
          </View>
        </View>

        {/* Playlists — full list when visible, otherwise just the count above */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Playlists</Text>
          {publicPlaylists === null ? (
            <View style={styles.privateNotice}>
              <Ionicons name="lock-closed-outline" size={22} color="#9CA3AF" />
              <Text style={styles.privateNoticeText}>
                This account is private. Follow {user.username ?? 'them'} to see their playlists.
              </Text>
            </View>
          ) : publicPlaylists.length === 0 ? (
            <Text style={styles.emptyText}>No public playlists yet.</Text>
          ) : (
            <FlatList
              data={publicPlaylists}
              horizontal
              keyExtractor={(item) => `pl-${item.id}`}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              renderItem={({ item }) => (
                <PlaylistCard
                  playlist={item}
                  onPress={() => router.push({ pathname: '/playlist/[id]', params: { id: String(item.id) } })}
                />
              )}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  centerFill: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  notFoundText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#9CA3AF' },
  backLink: { marginTop: 16 },
  backLinkText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#0066FF' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  backBtn: { padding: 4, marginRight: 12 },
  headerTitle: { flex: 1, fontSize: 18, fontFamily: 'Inter_700Bold', color: '#111827' },

  identity: { alignItems: 'center', paddingTop: 28, paddingBottom: 20, paddingHorizontal: 20 },
  avatar: { width: 84, height: 84, borderRadius: 42 },
  avatarFallback: { backgroundColor: '#E0E7FF', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 28, fontFamily: 'Inter_700Bold', color: '#4F46E5' },
  usernameRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  username: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#111827' },

  followBtn: {
    marginTop: 16, backgroundColor: '#0066FF',
    paddingHorizontal: 28, paddingVertical: 9, borderRadius: 20,
  },
  followBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  followingBtn: { backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  followingBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#374151' },

  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 20, paddingVertical: 16,
    backgroundColor: '#F9FAFB', borderRadius: 14,
  },
  statTile: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#111827' },
  statLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginTop: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: '#E5E7EB' },

  section: { marginTop: 28 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#111827', paddingHorizontal: 20, marginBottom: 12 },
  horizontalList: { paddingHorizontal: 20 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF', paddingHorizontal: 20 },

  privateNotice: {
    marginHorizontal: 20, padding: 20, borderRadius: 12,
    backgroundColor: '#F9FAFB', alignItems: 'center', gap: 10,
  },
  privateNoticeText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#6B7280', textAlign: 'center', lineHeight: 19 },
});
