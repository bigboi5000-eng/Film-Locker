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
import { useAuth } from '@clerk/expo';
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
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

type Mode = 'followers' | 'following';

/** Where the viewer stands with one person in the list. */
type Relationship = 'self' | 'none' | 'pending' | 'accepted';

export default function ConnectionsScreen() {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ userId: string; mode?: string; username?: string }>();
  const userId = params.userId;
  const { userId: myClerkId } = useAuth();

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

  /**
   * "self" means this row is the signed-in user, not the person whose list
   * is open.
   *
   * It was comparing against the profile owner, which is a different
   * question and the wrong one: on a friend's followers list your own row
   * fell through to "not followed" and was given a Follow button pointing
   * at yourself. The viewer is who the button is about.
   */
  const relationshipFor = useCallback(
    (clerkId: string): Relationship =>
      clerkId === myClerkId ? 'self' : relationships.get(clerkId) ?? 'none',
    [relationships, myClerkId]
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

          {relationship === 'self' ? (
            <View style={styles.youChip}>
              <Text style={styles.youChipText}>You</Text>
            </View>
          ) : busyId === item.clerkId ? (
            <ActivityIndicator size="small" color={colors.primary} />
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
          <Ionicons name="chevron-back" size={24} color={colors.text} />
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
          <ActivityIndicator size="large" color={colors.primary} />
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
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons
                name={refused ? 'lock-closed-outline' : 'people-outline'}
                size={48}
                color={colors.iconFaint}
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

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  backBtn: { padding: 4, marginRight: 12 },
  headerTitle: { flex: 1, fontSize: 18, fontFamily: 'Inter_700Bold', color: c.text },

  switcher: {
    flexDirection: 'row',
    marginHorizontal: 16, marginTop: 14, marginBottom: 6,
    backgroundColor: c.surfaceAlt, borderRadius: 10, padding: 3,
  },
  switchBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  switchBtnActive: { backgroundColor: c.background },
  switchText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.textFaint },
  switchTextActive: { color: c.text },

  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11 },
  separator: { height: 1, backgroundColor: c.surfaceAlt, marginLeft: 72 },
  avatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  avatarFallback: { backgroundColor: c.avatarBg, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: c.avatarFg },
  rowBody: { flex: 1 },
  rowName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: c.text },
  rowMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textFaint, marginTop: 1 },

  youChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: c.avatarBg,
  },
  youChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: c.avatarFg },

  btn: { backgroundColor: c.primary, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20 },
  btnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.background },
  btnQuiet: { backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border },
  btnQuietText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.textStrong },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyText: {
    fontSize: 14, fontFamily: 'Inter_400Regular', color: c.textFaint,
    textAlign: 'center', lineHeight: 20,
  },
});
