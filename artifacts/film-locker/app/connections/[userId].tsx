/**
 * Followers and following, for any account the viewer may see them for.
 *
 * One screen with a switch rather than two routes: the two lists are the
 * same rows with a different query behind them, and someone comparing
 * "who follows them" against "who they follow" should not have to go back
 * and pick a different number to do it.
 *
 * Every row carries the viewer's own relationship to that person, computed
 * from GET /follows rather than asked of the server per row — which is the
 * same thing the Find People screen does, and is what makes this list a
 * place you can act from instead of just read.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetUserFollowers,
  useGetUserFollowing,
  getGetUserFollowersQueryKey,
  getGetUserFollowingQueryKey,
  useGetFollows,
  getGetFollowsQueryKey,
  useFollowUser,
  useUnfollowUser,
  getGetNotificationUsersQueryKey,
  type PublicUserProfile,
} from '@workspace/api-client-react';

type Mode = 'followers' | 'following';

/** Where the viewer stands with one person in the list. */
type Relationship = 'self' | 'none' | 'pending' | 'accepted';

export default function ConnectionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ userId: string; mode?: string; username?: string }>();
  const userId = params.userId;

  const [mode, setMode] = useState<Mode>(params.mode === 'following' ? 'following' : 'followers');
  const [busyId, setBusyId] = useState<string | null>(null);

  const followers = useGetUserFollowers(userId, {
    query: {
      queryKey: getGetUserFollowersQueryKey(userId),
      enabled: Boolean(userId) && mode === 'followers',
      retry: false,
    },
  });
  const following = useGetUserFollowing(userId, {
    query: {
      queryKey: getGetUserFollowingQueryKey(userId),
      enabled: Boolean(userId) && mode === 'following',
      retry: false,
    },
  });

  const active = mode === 'followers' ? followers : following;
  const users = active.data?.users ?? [];

  const { data: myFollows } = useGetFollows();
  const { mutateAsync: followUser } = useFollowUser();
  const { mutateAsync: unfollowUser } = useUnfollowUser();

  const relationships = useMemo(() => {
    const map = new Map<string, Relationship>();
    for (const u of myFollows?.following ?? []) map.set(u.clerkId, 'accepted');
    for (const u of myFollows?.outgoingRequests ?? []) map.set(u.clerkId, 'pending');
    return map;
  }, [myFollows]);

  const relationshipFor = useCallback(
    (clerkId: string): Relationship => (clerkId === userId ? 'self' : relationships.get(clerkId) ?? 'none'),
    [relationships, userId]
  );

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetFollowsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetNotificationUsersQueryKey() }),
    ]);
  }, [queryClient]);

  const toggleFollow = useCallback(
    async (user: PublicUserProfile, current: Relationship) => {
      setBusyId(user.clerkId);
      try {
        if (current === 'none') await followUser({ data: { followeeId: user.clerkId } });
        else await unfollowUser({ userId: user.clerkId });
        await invalidate();
      } catch {
        Alert.alert('Error', 'Could not update that follow.');
      } finally {
        setBusyId(null);
      }
    },
    [followUser, unfollowUser, invalidate]
  );

  // A private account's lists are refused rather than returned empty, so an
  // empty list and a list you may not see need different words.
  const refused = active.isError;

  const renderRow = useCallback(
    ({ item }: { item: PublicUserProfile }) => {
      const relationship = relationshipFor(item.clerkId);
      const initials = (item.displayInitials || item.username || '?').slice(0, 5).toUpperCase();

      return (
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.75}
          onPress={() => router.push(`/user/${item.clerkId}`)}
        >
          {item.avatarUrl ? (
            <Image source={{ uri: item.avatarUrl }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarText} numberOfLines={1} adjustsFontSizeToFit>{initials}</Text>
            </View>
          )}

          <View style={styles.rowBody}>
            <Text style={styles.rowName} numberOfLines={1}>{item.username ?? 'Unnamed user'}</Text>
            {item.isPrivate ? <Text style={styles.rowMeta}>Private account</Text> : null}
          </View>

          {relationship === 'self' ? null : busyId === item.clerkId ? (
            <ActivityIndicator size="small" color="#0066FF" />
          ) : relationship === 'accepted' ? (
            <TouchableOpacity
              style={[styles.btn, styles.btnQuiet]}
              onPress={() => toggleFollow(item, relationship)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnQuietText}>Following</Text>
            </TouchableOpacity>
          ) : relationship === 'pending' ? (
            <TouchableOpacity
              style={[styles.btn, styles.btnQuiet]}
              onPress={() => toggleFollow(item, relationship)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnQuietText}>Requested</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.btn}
              onPress={() => toggleFollow(item, relationship)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnText}>{item.isPrivate ? 'Request' : 'Follow'}</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      );
    },
    [relationshipFor, busyId, toggleFollow, router]
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {params.username ? params.username : 'Connections'}
        </Text>
      </View>

      <View style={styles.switcher}>
        <TouchableOpacity
          style={[styles.switchBtn, mode === 'followers' && styles.switchBtnActive]}
          onPress={() => setMode('followers')}
          activeOpacity={0.75}
        >
          <Text style={[styles.switchText, mode === 'followers' && styles.switchTextActive]}>
            Followers
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.switchBtn, mode === 'following' && styles.switchBtnActive]}
          onPress={() => setMode('following')}
          activeOpacity={0.75}
        >
          <Text style={[styles.switchText, mode === 'following' && styles.switchTextActive]}>
            Following
          </Text>
        </TouchableOpacity>
      </View>

      {active.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0066FF" />
        </View>
      ) : (
        <FlatList
          data={refused ? [] : users}
          keyExtractor={(u) => u.clerkId}
          renderItem={renderRow}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={
            (refused ? true : users.length === 0) ? { flex: 1 } : { paddingBottom: insets.bottom + 16 }
          }
          refreshControl={
            <RefreshControl
              refreshing={active.isRefetching}
              onRefresh={active.refetch}
              tintColor="#0066FF"
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons
                name={refused ? 'lock-closed-outline' : 'people-outline'}
                size={48}
                color="#D1D5DB"
              />
              <Text style={styles.emptyText}>
                {refused
                  ? 'This account is private, so these lists are hidden. Follow them to see who they are connected to.'
                  : mode === 'followers'
                    ? 'Nobody is following this account yet.'
                    : 'This account is not following anybody yet.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  backBtn: { padding: 4, marginRight: 12 },
  headerTitle: { flex: 1, fontSize: 18, fontFamily: 'Inter_700Bold', color: '#111827' },

  switcher: {
    flexDirection: 'row',
    marginHorizontal: 16, marginTop: 14, marginBottom: 6,
    backgroundColor: '#F3F4F6', borderRadius: 10, padding: 3,
  },
  switchBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  switchBtnActive: { backgroundColor: '#FFFFFF' },
  switchText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#9CA3AF' },
  switchTextActive: { color: '#111827' },

  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11 },
  separator: { height: 1, backgroundColor: '#F3F4F6', marginLeft: 72 },
  avatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  avatarFallback: { backgroundColor: '#E0E7FF', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#4F46E5' },
  rowBody: { flex: 1 },
  rowName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#111827' },
  rowMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginTop: 1 },

  btn: { backgroundColor: '#0066FF', paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20 },
  btnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  btnQuiet: { backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  btnQuietText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#374151' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyText: {
    fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF',
    textAlign: 'center', lineHeight: 20,
  },
});
