import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput,
  TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useSearchUsers,
  getSearchUsersQueryKey,
  useGetFollows,
  useFollowUser,
  useUnfollowUser,
  getGetFollowsQueryKey,
  getGetNotificationUsersQueryKey,
  type PublicUserProfile,
} from '@workspace/api-client-react';

export default function PeopleScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [actionUserId, setActionUserId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const { data: searchData, isLoading: searchLoading } = useSearchUsers(
    { q: debouncedQ },
    { query: { queryKey: getSearchUsersQueryKey({ q: debouncedQ }), enabled: debouncedQ.length >= 2 } }
  );

  const { data: followsData, isLoading: followsLoading } = useGetFollows();
  const { mutateAsync: followUser } = useFollowUser();
  const { mutateAsync: unfollowUser } = useUnfollowUser();

  const followingIds = new Set((followsData?.following ?? []).map((u) => u.clerkId));

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: getGetFollowsQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getGetNotificationUsersQueryKey() });
  }, [queryClient]);

  const handleFollow = useCallback(async (user: PublicUserProfile) => {
    setActionUserId(user.clerkId);
    try {
      await followUser({ data: { followeeId: user.clerkId } });
      await invalidate();
    } catch {
      Alert.alert('Error', 'Could not follow this user.');
    } finally {
      setActionUserId(null);
    }
  }, [followUser, invalidate]);

  const handleUnfollow = useCallback(async (user: PublicUserProfile) => {
    setActionUserId(user.clerkId);
    try {
      await unfollowUser({ userId: user.clerkId });
      await invalidate();
    } catch {
      Alert.alert('Error', 'Could not unfollow this user.');
    } finally {
      setActionUserId(null);
    }
  }, [unfollowUser, invalidate]);

  function UserRow({ user, isFollowing }: { user: PublicUserProfile; isFollowing: boolean }) {
    const initials = (user.displayInitials || user.username || '??').slice(0, 5).toUpperCase();
    const busy = actionUserId === user.clerkId;
    return (
      <View style={styles.userRow}>
        {user.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarText} numberOfLines={1} adjustsFontSizeToFit>{initials}</Text>
          </View>
        )}
        <View style={styles.userInfo}>
          <Text style={styles.username}>{user.username ?? 'Unnamed user'}</Text>
        </View>
        {busy ? (
          <ActivityIndicator size="small" color="#0066FF" style={{ marginLeft: 12 }} />
        ) : isFollowing ? (
          <TouchableOpacity style={styles.unfollowBtn} onPress={() => handleUnfollow(user)} activeOpacity={0.8}>
            <Text style={styles.unfollowBtnText}>Following</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.followBtn} onPress={() => handleFollow(user)} activeOpacity={0.8}>
            <Text style={styles.followBtnText}>Follow</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const searchResults = searchData?.users ?? [];
  const following = followsData?.following ?? [];
  const followers = followsData?.followers ?? [];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Find People</Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={18} color="#9CA3AF" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by username or email…"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} style={styles.clearBtn}>
            <Ionicons name="close-circle" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={[]}
        renderItem={null}
        ListHeaderComponent={
          <>
            {/* Search results */}
            {debouncedQ.length >= 2 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Search Results</Text>
                {searchLoading ? (
                  <ActivityIndicator color="#0066FF" style={{ marginVertical: 16 }} />
                ) : searchResults.length === 0 ? (
                  <Text style={styles.emptyText}>No users found for "{debouncedQ}"</Text>
                ) : (
                  searchResults.map((u) => (
                    <UserRow key={u.clerkId} user={u} isFollowing={followingIds.has(u.clerkId)} />
                  ))
                )}
              </View>
            )}

            {/* Following */}
            {debouncedQ.length < 2 && (
              <>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    Following{following.length > 0 ? ` (${following.length})` : ''}
                  </Text>
                  {followsLoading ? (
                    <ActivityIndicator color="#0066FF" style={{ marginVertical: 16 }} />
                  ) : following.length === 0 ? (
                    <Text style={styles.emptyText}>You're not following anyone yet. Search above to find people.</Text>
                  ) : (
                    following.map((u) => (
                      <UserRow key={u.clerkId} user={u} isFollowing={true} />
                    ))
                  )}
                </View>

                {followers.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Followers ({followers.length})</Text>
                    {followers.map((u) => (
                      <UserRow key={u.clerkId} user={u} isFollowing={followingIds.has(u.clerkId)} />
                    ))}
                  </View>
                )}
              </>
            )}
          </>
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
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
  backBtn: { padding: 4, marginRight: 12 },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#111827' },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    margin: 16, paddingHorizontal: 12,
    backgroundColor: '#F9FAFB', borderRadius: 10,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1, paddingVertical: 12,
    fontSize: 15, fontFamily: 'Inter_400Regular', color: '#111827',
  },
  clearBtn: { padding: 4 },

  section: { paddingHorizontal: 16, marginBottom: 24 },
  sectionTitle: {
    fontSize: 13, fontFamily: 'Inter_600SemiBold',
    color: '#9CA3AF', letterSpacing: 0.5, textTransform: 'uppercase',
    marginBottom: 12,
  },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF', lineHeight: 20 },

  userRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  avatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  avatarFallback: { backgroundColor: '#E0E7FF', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#4F46E5' },
  userInfo: { flex: 1 },
  username: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#111827' },
  email: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginTop: 1 },

  followBtn: {
    backgroundColor: '#0066FF', paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
  },
  followBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  unfollowBtn: {
    backgroundColor: '#F3F4F6', paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  unfollowBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#374151' },
});
