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
import { webInputReset } from '@/lib/webInputReset';
import { confirmDestructive } from '@/lib/confirm';
import { useToast } from '@/components/ToastProvider';
import {
  useSearchUsers,
  getSearchUsersQueryKey,
  useGetFollows,
  useFollowUser,
  useUnfollowUser,
  useBlockUser,
  getGetFollowsQueryKey,
  getGetNotificationUsersQueryKey,
  type PublicUserProfile,
} from '@workspace/api-client-react';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

export default function PeopleScreen() {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
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
  const { mutateAsync: blockUser } = useBlockUser();
  const { showToast } = useToast();

  const followingIds = new Set((followsData?.following ?? []).map((u) => u.clerkId));
  const pendingOutgoingIds = new Set((followsData?.outgoingRequests ?? []).map((u) => u.clerkId));

  function followState(clerkId: string): 'none' | 'pending' | 'accepted' {
    if (followingIds.has(clerkId)) return 'accepted';
    if (pendingOutgoingIds.has(clerkId)) return 'pending';
    return 'none';
  }

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

  const handleBlock = useCallback((user: PublicUserProfile) => {
    const name = user.username ?? 'this user';
    confirmDestructive(
      `Block ${name}? They won't be able to follow, message, or see your comments, and you won't see theirs.`,
      'Block',
      async () => {
        setActionUserId(user.clerkId);
        try {
          await blockUser({ data: { blockedId: user.clerkId } });
          await invalidate();
          showToast({ title: `Blocked ${name}`, variant: 'success' });
        } catch {
          showToast({ title: 'Could not block this user', variant: 'error' });
        } finally {
          setActionUserId(null);
        }
      }
    );
  }, [blockUser, invalidate, showToast]);

  function UserRow({ user, state }: { user: PublicUserProfile; state: 'none' | 'pending' | 'accepted' }) {
    const initials = (user.displayInitials || user.username || '??').slice(0, 5).toUpperCase();
    const busy = actionUserId === user.clerkId;
    return (
      <TouchableOpacity
        style={styles.userRow}
        onPress={() => router.push(`/user/${user.clerkId}`)}
        onLongPress={() => handleBlock(user)}
        delayLongPress={400}
        activeOpacity={0.7}
      >
        {user.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarText} numberOfLines={1} adjustsFontSizeToFit>{initials}</Text>
          </View>
        )}
        <View style={styles.userInfo}>
          <View style={styles.usernameRow}>
            <Text style={styles.username}>{user.username ?? 'Unnamed user'}</Text>
            {user.isPrivate && <Ionicons name="lock-closed" size={12} color={colors.textFaint} style={{ marginLeft: 4 }} />}
          </View>
        </View>
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 12 }} />
        ) : state === 'accepted' ? (
          <TouchableOpacity style={styles.unfollowBtn} onPress={() => handleUnfollow(user)} activeOpacity={0.8}>
            <Text style={styles.unfollowBtnText}>Following</Text>
          </TouchableOpacity>
        ) : state === 'pending' ? (
          <TouchableOpacity style={styles.unfollowBtn} onPress={() => handleUnfollow(user)} activeOpacity={0.8}>
            <Text style={styles.unfollowBtnText}>Requested</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.followBtn} onPress={() => handleFollow(user)} activeOpacity={0.8}>
            <Text style={styles.followBtnText}>{user.isPrivate ? 'Request' : 'Follow'}</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
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
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Find People</Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={18} color={colors.textFaint} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by username or email…"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} style={styles.clearBtn}>
            <Ionicons name="close-circle" size={18} color={colors.textFaint} />
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
                  <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
                ) : searchResults.length === 0 ? (
                  <Text style={styles.emptyText}>No users found for "{debouncedQ}"</Text>
                ) : (
                  searchResults.map((u) => (
                    <UserRow key={u.clerkId} user={u} state={followState(u.clerkId)} />
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
                    <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
                  ) : following.length === 0 ? (
                    <Text style={styles.emptyText}>You're not following anyone yet. Search above to find people.</Text>
                  ) : (
                    following.map((u) => (
                      <UserRow key={u.clerkId} user={u} state="accepted" />
                    ))
                  )}
                </View>

                {followers.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Followers ({followers.length})</Text>
                    {followers.map((u) => (
                      <UserRow key={u.clerkId} user={u} state={followState(u.clerkId)} />
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

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  backBtn: { padding: 4, marginRight: 12 },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: c.text },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    margin: 16, paddingHorizontal: 12,
    backgroundColor: c.surfaceSubtle, borderRadius: 10,
    borderWidth: 1, borderColor: c.border,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1, paddingVertical: 12,
    fontSize: 15, fontFamily: 'Inter_400Regular', color: c.text,
    ...webInputReset,
  },
  clearBtn: { padding: 4 },

  section: { paddingHorizontal: 16, marginBottom: 24 },
  sectionTitle: {
    fontSize: 13, fontFamily: 'Inter_600SemiBold',
    color: c.textFaint, letterSpacing: 0.5, textTransform: 'uppercase',
    marginBottom: 12,
  },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: c.textFaint, lineHeight: 20 },

  userRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: c.surfaceAlt,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  avatarFallback: { backgroundColor: c.avatarBg, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: c.avatarFg },
  userInfo: { flex: 1 },
  usernameRow: { flexDirection: 'row', alignItems: 'center' },
  username: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: c.text },
  email: { fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textFaint, marginTop: 1 },

  followBtn: {
    backgroundColor: c.primary, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
  },
  followBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.background },
  unfollowBtn: {
    backgroundColor: c.surfaceAlt, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: c.border,
  },
  unfollowBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.textStrong },
});
