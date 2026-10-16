import React, { useCallback, useEffect, useState } from 'react';
import { SignedOutGate } from '@/components/SignedOutGate';
import { useAuth } from '@clerk/expo';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetConversations,
  useGetFollows,
  useAcceptFollowRequest,
  useDeclineFollowRequest,
  useUnfollowUser,
  useFollowUser,
  getGetFollowsQueryKey,
  getGetNotificationUsersQueryKey,
  type ConversationSummary,
  type PublicUserProfile,
} from '@workspace/api-client-react';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

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

/**
 * What the row says happened last.
 *
 * A conversation is recommendations and reactions in both directions, so the
 * latest thing in it is often not a film at all — it may be a Film Pal's
 * "Loved it!" about something you sent them. Rendering only the film title
 * (which is null on a message) is how the inbox used to show a blank line
 * for the half of all activity that is a reaction.
 */
function describeLast(item: ConversationSummary['lastItem'], mine: boolean): string {
  const prefix = mine ? 'You: ' : '';
  if (item.type === 'message') {
    const body = item.content ?? '';
    return item.replyToFilmTitle
      ? `${prefix}${body} · ${item.replyToFilmTitle}`
      : `${prefix}${body}`;
  }
  return `${prefix}🎬 ${item.filmTitle ?? 'a film'}`;
}

function ConversationRow({
  conversation,
  myClerkId,
  onPress,
}: {
  conversation: ConversationSummary;
  myClerkId: string | null | undefined;
  onPress: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { user, lastItem, unreadCount, posters } = conversation;
  const initials = (user.displayInitials || user.username || '?').slice(0, 5).toUpperCase();
  const previews = posters.slice(0, 3);
  const mine = lastItem.fromUserId === myClerkId;

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.75}>
      {/* Avatar — tapping this opens the profile instead of the thread */}
      <TouchableOpacity
        style={styles.avatarWrap}
        onPress={() => router.push(`/user/${user.clerkId}`)}
        activeOpacity={0.7}
      >
        {user.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarText} numberOfLines={1} adjustsFontSizeToFit>{initials}</Text>
          </View>
        )}
        {unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.contentHeader}>
          <Text style={[styles.username, unreadCount > 0 && styles.usernameUnread]} numberOfLines={1}>
            {user.username ?? 'Unknown'}
          </Text>
          <Text style={styles.time}>{formatRelative(new Date(lastItem.createdAt))}</Text>
        </View>
        <Text style={styles.preview} numberOfLines={1}>
          {describeLast(lastItem, mine)}
        </Text>
      </View>

      {/* Poster stack preview */}
      <View style={styles.posterStack}>
        {previews.map((uri, i) => (
          <Image
            key={i}
            source={{ uri }}
            style={[styles.previewPoster, { right: i * 16, zIndex: 3 - i }]}
            contentFit="cover"
          />
        ))}
      </View>

      <Ionicons name="chevron-forward" size={16} color={colors.iconFaint} style={{ marginLeft: 4 }} />
    </TouchableOpacity>
  );
}

// ── Film Pals — people you follow and who follow you back, plus incoming and
// outgoing follow requests. Lives as a second tab on this screen since it's
// the same "people I have a relationship with" surface as the inbox. ──

function PalAvatar({ user, onPress }: { user: PublicUserProfile; onPress?: () => void }) {
  const styles = useThemedStyles(makeStyles);
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
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch, isRefetching } = useGetFollows();
  const { mutateAsync: acceptRequest } = useAcceptFollowRequest();
  const { mutateAsync: declineRequest } = useDeclineFollowRequest();
  const { mutateAsync: unfollowUser } = useUnfollowUser();
  const { mutateAsync: followUser } = useFollowUser();
  const [busyId, setBusyId] = useState<string | null>(null);

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: getGetFollowsQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getGetNotificationUsersQueryKey() });
  }, [queryClient]);

  const incomingRequests = data?.incomingRequests ?? [];
  const outgoingRequests = data?.outgoingRequests ?? [];
  const following = data?.following ?? [];
  const followers = data?.followers ?? [];
  const followerIds = new Set(followers.map((u) => u.clerkId));
  const followingIds = new Set(following.map((u) => u.clerkId));
  const filmPals = following.filter((u) => followerIds.has(u.clerkId));

  /**
   * People following me that I have not followed back.
   *
   * These had nowhere to appear. This screen showed requests, requests I had
   * sent, and Film Pals — and Film Pals is mutual-only, so a one-way
   * follower was invisible here and findable only by scrolling the Find
   * People screen. That matters more than a missing list: a mutual follow is
   * what the server requires before two people can message each other, so
   * the only route to a conversation was both people independently going
   * looking for each other.
   */
  const notFollowedBack = followers.filter((u) => !followingIds.has(u.clerkId));

  const handleFollowBack = useCallback(async (user: PublicUserProfile) => {
    setBusyId(user.clerkId);
    try {
      await followUser({ data: { followeeId: user.clerkId } });
      await invalidate();
    } catch {
      Alert.alert('Error', 'Could not follow this person.');
    } finally {
      setBusyId(null);
    }
  }, [followUser, invalidate]);

  const handleAccept = useCallback(async (user: PublicUserProfile) => {
    setBusyId(user.clerkId);
    try {
      await acceptRequest({ userId: user.clerkId });
      await invalidate();
      // Accepting only grants them access to me. The server requires an
      // accepted follow in BOTH directions before either of us can message
      // the other, so without this the accept appears to do the job and the
      // conversation stays locked with nothing on screen explaining why.
      Alert.alert(
        `${user.username ?? 'They'} can now see your films`,
        'Follow them back to become Film Pals — that is what lets the two of you send films and react to each other.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Follow back', onPress: () => { void handleFollowBack(user); } },
        ]
      );
    } catch {
      Alert.alert('Error', 'Could not accept this request.');
    } finally {
      setBusyId(null);
    }
  }, [acceptRequest, invalidate, handleFollowBack]);

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
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isEmpty =
    incomingRequests.length === 0 &&
    outgoingRequests.length === 0 &&
    notFollowedBack.length === 0 &&
    filmPals.length === 0;

  return (
    <FlatList
      data={[]}
      renderItem={null}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
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
                    <ActivityIndicator size="small" color={colors.primary} />
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
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <TouchableOpacity style={styles.pendingBtn} onPress={() => handleCancel(u)} activeOpacity={0.8}>
                      <Text style={styles.pendingBtnText}>Requested</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}

          {notFollowedBack.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Following you ({notFollowedBack.length})</Text>
              <Text style={styles.sectionHint}>
                Follow back to become Film Pals and open a conversation.
              </Text>
              {notFollowedBack.map((u) => (
                <View key={u.clerkId} style={styles.palRow}>
                  <PalAvatar user={u} onPress={() => router.push(`/user/${u.clerkId}`)} />
                  <Text style={styles.palName} numberOfLines={1}>{u.username ?? 'Unnamed user'}</Text>
                  {busyId === u.clerkId ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <TouchableOpacity
                      style={styles.acceptBtn}
                      onPress={() => handleFollowBack(u)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.acceptBtnText}>Follow back</Text>
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
                  <Ionicons name="chevron-forward" size={16} color={colors.iconFaint} />
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

function NotificationsScreenInner() {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId: myClerkId } = useAuth();
  /**
   * Messages or Friends. The feed moved out to a tab of its own — it was
   * the one thing here nobody arrived looking for, which is exactly why it
   * should not have been two taps inside something else.
   *
   * Overridable by ?tab=, because a push notification about a follow
   * request sends people here to accept it and the controls for that are on
   * Friends.
   */
  const { tab: requestedTab } = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = useState<'messages' | 'friends'>(() =>
    requestedTab === 'friends' ? 'friends' : 'messages'
  );

  // The initialiser above only covers a cold start. The tab screens stay
  // mounted, so a notification tapped while the app is already running
  // navigates to a screen whose state has long since been set — and would
  // leave somebody on Messages when they came to accept a request. Keyed on
  // the parameter, so choosing the other sub-tab afterwards sticks.
  useEffect(() => {
    if (requestedTab === 'friends' || requestedTab === 'messages') setActiveTab(requestedTab);
  }, [requestedTab]);
  const { data, isLoading, refetch, isRefetching } = useGetConversations();
  const { data: followsData } = useGetFollows();
  const incomingRequestCount = followsData?.incomingRequests?.length ?? 0;


  const conversations = data?.conversations ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  const handleOpenThread = useCallback(
    (conversation: ConversationSummary) => {
      router.push({
        pathname: '/inbox/[userId]',
        params: {
          userId: conversation.user.clerkId,
          username: conversation.user.username ?? '',
        },
      });
    },
    [router]
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Community</Text>
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
          <Ionicons name="people-outline" size={18} color={colors.primary} />
          <Text style={styles.peopleBtnText}>Find People</Text>
        </TouchableOpacity>
      </View>

      {/* Tab switcher */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'messages' && styles.tabBtnActive]}
          onPress={() => setActiveTab('messages')}
          activeOpacity={0.75}
        >
          <Text style={[styles.tabBtnText, activeTab === 'messages' && styles.tabBtnTextActive]}>Messages</Text>
          {unreadCount > 0 && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'friends' && styles.tabBtnActive]}
          onPress={() => setActiveTab('friends')}
          activeOpacity={0.75}
        >
          <Text style={[styles.tabBtnText, activeTab === 'friends' && styles.tabBtnTextActive]}>Friends</Text>
          {incomingRequestCount > 0 && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>{incomingRequestCount > 9 ? '9+' : incomingRequestCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {activeTab === 'friends' ? (
        <FilmPalsView />
      ) : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(c) => c.user.clerkId}
          renderItem={({ item }) => (
            <ConversationRow
              conversation={item}
              myClerkId={myClerkId}
              onPress={() => handleOpenThread(item)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="mail-open-outline" size={56} color={colors.iconFaint} />
              <Text style={styles.emptyTitle}>No conversations yet</Text>
              <Text style={styles.emptySub}>
                Recommend a film to a Film Pal, or wait for one to land here.
              </Text>
              <TouchableOpacity
                style={styles.findBtn}
                onPress={() => router.push('/people')}
                activeOpacity={0.8}
              >
                <Ionicons name="people-outline" size={16} color={colors.background} />
                <Text style={styles.findBtnText}>Find People</Text>
              </TouchableOpacity>
            </View>
          }
          contentContainerStyle={
            conversations.length === 0 ? { flex: 1 } : { paddingBottom: insets.bottom + 16 }
          }
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: c.text },
  headerBadge: {
    backgroundColor: c.primary, borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  headerBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: c.background },
  peopleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: c.primarySoft, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
  },
  peopleBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.primary },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  tabBar: {
    flexDirection: 'row', paddingHorizontal: 20, paddingTop: 12, gap: 8,
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  tabBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 4, paddingBottom: 10,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabBtnActive: { borderBottomColor: c.primary },
  tabBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: c.textFaint },
  tabBtnTextActive: { color: c.primary },
  tabBadge: {
    backgroundColor: c.destructive, borderRadius: 9, minWidth: 18, height: 18,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  tabBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: c.background },

  section: { paddingHorizontal: 16, paddingTop: 20 },
  sectionHint: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: c.textFaint,
    marginTop: -2,
    marginBottom: 10,
    lineHeight: 17,
  },
  sectionTitle: {
    fontSize: 13, fontFamily: 'Inter_600SemiBold',
    color: c.textFaint, letterSpacing: 0.5, textTransform: 'uppercase',
    marginBottom: 8,
  },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: c.textFaint, lineHeight: 20 },

  palRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.surfaceAlt,
  },
  palName: { flex: 1, fontSize: 15, fontFamily: 'Inter_600SemiBold', color: c.text },
  acceptBtn: {
    backgroundColor: c.primary, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  acceptBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.background },
  declineBtn: {
    backgroundColor: c.surfaceAlt, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: c.border,
  },
  declineBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.textStrong },
  pendingBtn: {
    backgroundColor: c.surfaceAlt, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: c.border,
  },
  pendingBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.textStrong },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: c.background,
  },
  avatarWrap: { position: 'relative', marginRight: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: { backgroundColor: c.avatarBg, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: c.avatarFg },
  unreadBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4, borderWidth: 2, borderColor: c.background,
  },
  unreadBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: c.background },

  content: { flex: 1 },
  contentHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  username: { fontSize: 15, fontFamily: 'Inter_500Medium', color: c.textStrong },
  usernameUnread: { fontFamily: 'Inter_700Bold', color: c.text },
  time: { fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textFaint },
  preview: { fontSize: 13, fontFamily: 'Inter_400Regular', color: c.textMuted },

  posterStack: { position: 'relative', width: 60, height: 52, marginLeft: 8, marginRight: 4 },
  previewPoster: {
    position: 'absolute', width: 36, height: 52,
    borderRadius: 4, borderWidth: 1.5, borderColor: c.background,
  },

  separator: { height: 1, backgroundColor: c.surfaceAlt, marginLeft: 76 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: c.textStrong, textAlign: 'center' },
  emptySub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: c.textFaint, textAlign: 'center', lineHeight: 20 },
  findBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, marginTop: 4,
  },
  findBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: c.background },
});


/**
 * Browsing films needs no account, and guideline 5.1.1(v) requires that it
 * does not have one. This tab is account based, so it explains itself rather
 * than redirecting anyone to a sign-in screen.
 *
 * The gate sits here, around the screen, rather than inside it: an early
 * return within the component would run a different number of hooks when
 * signed out than when signed in, which React does not allow.
 */
export default function NotificationsScreen() {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <SignedOutGate
        icon="notifications-outline"
        title="Recommendations from friends"
        blurb="Follow people, swap film recommendations and message your Film Pals. All of it needs an account."
      />
    );
  }
  return <NotificationsScreenInner />;
}
