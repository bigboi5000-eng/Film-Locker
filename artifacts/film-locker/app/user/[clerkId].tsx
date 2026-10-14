/**
 * Someone else's profile.
 *
 * The job of this screen is to give a reason to follow the person, so it
 * leads with their films rather than with three numbers. What it can show
 * depends entirely on where the viewer stands, and the three bars are not
 * the same:
 *
 *  - ratings, reviews and playlists need a one-way accepted follow (or a
 *    public account);
 *  - watched films need a mutual follow, which is the strictest bar in the
 *    app and the reason the hero imagery is not built from them — for
 *    anyone you have just discovered, recentWatched is null;
 *  - the follower and following counts are public, their lists are not.
 *
 * The server decides all of that and sends null for a section the viewer
 * may not see, so nothing here infers visibility from the relationship.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  FlatList,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetUserProfile,
  getGetUserProfileQueryKey,
  useFollowUser,
  useUnfollowUser,
  useGetFollows,
  getGetFollowsQueryKey,
  getGetNotificationUsersQueryKey,
  type ProfileFilmCard,
} from '@workspace/api-client-react';
import { PlaylistCard } from '@/components/PlaylistCard';
import { WatchedFilmsSheet } from '@/components/WatchedFilmsSheet';
import { FilmDetailModal } from '@/components/FilmDetailModal';

/** How many posters the hero band shows before it starts repeating itself. */
const HERO_POSTERS = 5;

function initialsFor(displayInitials?: string | null, username?: string | null): string {
  return (displayInitials || username || '??').slice(0, 5).toUpperCase();
}

/** One film in a horizontal strip. */
function FilmStripCard({
  film,
  meta,
  onPress,
}: {
  film: ProfileFilmCard;
  meta?: string | null;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.filmCard} onPress={onPress} activeOpacity={0.8}>
      {film.posterUrl ? (
        <Image source={{ uri: film.posterUrl }} style={styles.filmPoster} contentFit="cover" />
      ) : (
        <View style={[styles.filmPoster, styles.filmPosterFallback]}>
          <Ionicons name="film-outline" size={22} color="#9CA3AF" />
        </View>
      )}
      <Text style={styles.filmTitle} numberOfLines={2}>
        {film.title ?? 'Unknown film'}
      </Text>
      {meta ? <Text style={styles.filmMeta}>{meta}</Text> : null}
    </TouchableOpacity>
  );
}

/** A 1–5 score as stars, which reads faster than a number in a strip. */
function stars(rating: number | null | undefined): string | null {
  if (typeof rating !== 'number' || rating < 1) return null;
  return '★'.repeat(Math.min(rating, 5));
}

export default function UserProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { clerkId } = useLocalSearchParams<{ clerkId: string }>();

  const [busy, setBusy] = useState(false);
  const [watchedVisible, setWatchedVisible] = useState(false);
  const [selected, setSelected] = useState<ProfileFilmCard | null>(null);

  const { data, isLoading } = useGetUserProfile(clerkId, {
    query: { queryKey: getGetUserProfileQueryKey(clerkId), enabled: Boolean(clerkId) },
  });
  const { mutateAsync: followUser } = useFollowUser();
  const { mutateAsync: unfollowUser } = useUnfollowUser();
  const { data: followsData } = useGetFollows();

  const isFilmPal = (() => {
    const following = followsData?.following ?? [];
    const followerIds = new Set((followsData?.followers ?? []).map((u) => u.clerkId));
    return following.some((u) => u.clerkId === clerkId && followerIds.has(u.clerkId));
  })();

  /**
   * The posters behind the name.
   *
   * Drawn from whatever this viewer is allowed to see, in order of how much
   * it says about the person: what they have watched, then what they have
   * rated, then the covers of their public playlists. A profile with none of
   * those gets the gradient on its own rather than a row of grey holes.
   */
  const heroPosters = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (uri?: string | null) => {
      if (!uri || seen.has(uri) || out.length >= HERO_POSTERS) return;
      seen.add(uri);
      out.push(uri);
    };
    for (const f of data?.recentWatched ?? []) push(f.posterUrl);
    for (const f of data?.recentRatings ?? []) push(f.posterUrl);
    for (const pl of data?.publicPlaylists ?? []) (pl.coverPosters ?? []).forEach(push);
    return out;
  }, [data]);

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

  const openConnections = useCallback(
    (mode: 'followers' | 'following') => {
      router.push({
        pathname: '/connections/[userId]',
        params: { userId: clerkId, mode, username: data?.user.username ?? '' },
      });
    },
    [router, clerkId, data?.user.username]
  );

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

  const {
    user,
    followStatus,
    followsYou,
    stats,
    publicPlaylists,
    recentRatings,
    recentComments,
    recentWatched,
  } = data;
  const initials = initialsFor(user.displayInitials, user.username);
  const them = user.username ?? 'them';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{user.username ?? 'Profile'}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>
        {/* Hero — their films, dimmed, behind their name. */}
        <View style={styles.hero}>
          <View style={styles.heroPosters}>
            {heroPosters.map((uri, i) => (
              <Image key={i} source={{ uri }} style={styles.heroPoster} contentFit="cover" />
            ))}
          </View>
          <LinearGradient
            colors={['rgba(17,24,39,0.35)', 'rgba(17,24,39,0.82)', '#FFFFFF']}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>

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
          </View>

          {/* Account type, spelled out. A bare padlock told you nothing if you
              had not already learned what it meant, and nothing at all on a
              public account. */}
          <View style={styles.badgeRow}>
            <Ionicons name={user.isPrivate ? 'lock-closed' : 'earth'} size={12} color="#6B7280" />
            <Text style={styles.badgeText}>
              {user.isPrivate ? 'Private account' : 'Public account'}
            </Text>
          </View>

          {/* Counts are public even where the lists are not, so these always
              show; tapping one is what finds out whether it opens. */}
          <View style={styles.connectionsRow}>
            <TouchableOpacity onPress={() => openConnections('followers')} activeOpacity={0.7}>
              <Text style={styles.connectionsText}>
                <Text style={styles.connectionsValue}>{stats.followerCount}</Text>
                {stats.followerCount === 1 ? ' follower' : ' followers'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.connectionsDot}>·</Text>
            <TouchableOpacity onPress={() => openConnections('following')} activeOpacity={0.7}>
              <Text style={styles.connectionsText}>
                <Text style={styles.connectionsValue}>{stats.followingCount}</Text> following
              </Text>
            </TouchableOpacity>
          </View>

          {/* Where the two of you stand. Messaging needs a follow each way, so
              "Following" on its own is not enough to explain why a
              conversation is or is not available. */}
          {followStatus !== 'self' && (
            <Text style={styles.relationshipText}>
              {followStatus === 'accepted' && followsYou
                ? 'Film Pals — you follow each other, so you can message'
                : followStatus === 'accepted'
                  ? `You follow ${them}. They need to follow you back before you can message.`
                  : followStatus === 'pending'
                    ? 'Follow request sent, waiting for them to accept'
                    : followsYou
                      ? `${user.username ?? 'They'} follows you. Follow back to become Film Pals and message.`
                      : user.isPrivate
                        ? 'Send a request to follow this account'
                        : 'Follow to see more and start messaging'}
            </Text>
          )}

          {followStatus !== 'self' && (
            <View style={styles.actionRow}>
              {busy ? (
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
              )}

              {/* The conversation had no door from here at all: a Film Pal's
                  profile told you that you could message them and left you to
                  find the Inbox tab and the right row yourself. */}
              {!busy && followStatus === 'accepted' && followsYou && (
                <TouchableOpacity
                  style={styles.messageBtn}
                  onPress={() =>
                    router.push({
                      pathname: '/inbox/[userId]',
                      params: { userId: clerkId, username: user.username ?? '' },
                    })
                  }
                  activeOpacity={0.8}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={16} color="#0066FF" />
                  <Text style={styles.messageBtnText}>Message</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Headline stats */}
        <View style={styles.statsRow}>
          {followStatus === 'self' || isFilmPal ? (
            <TouchableOpacity style={styles.statTile} onPress={() => setWatchedVisible(true)} activeOpacity={0.7}>
              <Text style={styles.statValue}>{stats.watchedCount}</Text>
              <Text style={styles.statLabel}>Watched</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.statTile}>
              <Text style={styles.statValue}>{stats.watchedCount}</Text>
              <Text style={styles.statLabel}>Watched</Text>
            </View>
          )}
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

        {/* Private accounts get one explanation, at the top, rather than the
            same padlock repeated under every heading. */}
        {publicPlaylists === null && recentRatings === null ? (
          <View style={styles.privateNotice}>
            <Ionicons name="lock-closed-outline" size={22} color="#9CA3AF" />
            <Text style={styles.privateNoticeText}>
              This account is private. Follow {them} to see what they have been watching, rating
              and recommending.
            </Text>
          </View>
        ) : null}

        {recentWatched && recentWatched.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recently watched</Text>
            <FlatList
              data={recentWatched}
              horizontal
              keyExtractor={(f) => `w-${f.tmdbId}`}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              renderItem={({ item }) => (
                <FilmStripCard film={item} meta={stars(item.rating)} onPress={() => setSelected(item)} />
              )}
            />
          </View>
        ) : null}

        {recentRatings && recentRatings.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Rated</Text>
            <FlatList
              data={recentRatings}
              horizontal
              keyExtractor={(f) => `r-${f.tmdbId}`}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              renderItem={({ item }) => (
                <FilmStripCard film={item} meta={stars(item.rating)} onPress={() => setSelected(item)} />
              )}
            />
          </View>
        ) : null}

        {recentComments && recentComments.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reviews</Text>
            {recentComments.map((c) => (
              <TouchableOpacity
                key={`c-${c.tmdbId}-${String(c.at)}`}
                style={styles.reviewRow}
                onPress={() => setSelected(c)}
                activeOpacity={0.8}
              >
                {c.posterUrl ? (
                  <Image source={{ uri: c.posterUrl }} style={styles.reviewPoster} contentFit="cover" />
                ) : (
                  <View style={[styles.reviewPoster, styles.filmPosterFallback]}>
                    <Ionicons name="film-outline" size={18} color="#9CA3AF" />
                  </View>
                )}
                <View style={styles.reviewBody}>
                  <Text style={styles.reviewFilm} numberOfLines={1}>{c.title ?? 'Unknown film'}</Text>
                  <Text style={styles.reviewText} numberOfLines={3}>{c.comment}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* Playlists — full list when visible, otherwise just the count above */}
        {publicPlaylists !== null ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Playlists</Text>
            {publicPlaylists.length === 0 ? (
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
        ) : null}

        {/* A public account that has not done anything yet still needs to say
            so, or the screen just stops under the stats. */}
        {publicPlaylists !== null &&
        publicPlaylists.length === 0 &&
        (recentRatings?.length ?? 0) === 0 &&
        (recentComments?.length ?? 0) === 0 &&
        (recentWatched?.length ?? 0) === 0 ? (
          <Text style={styles.quietText}>
            {user.username ?? 'This person'} hasn&apos;t rated or reviewed anything yet.
          </Text>
        ) : null}
      </ScrollView>

      <WatchedFilmsSheet
        visible={watchedVisible}
        clerkId={clerkId}
        username={user.username ?? 'Their'}
        onClose={() => setWatchedVisible(false)}
      />

      {selected && (
        <FilmDetailModal
          visible
          onClose={() => setSelected(null)}
          tmdbId={selected.tmdbId}
          title={selected.title ?? ''}
          posterUrl={selected.posterUrl ?? ''}
          releaseYear={selected.releaseYear ?? ''}
          overview=""
        />
      )}
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

  hero: { height: 150, backgroundColor: '#1F2937', overflow: 'hidden' },
  heroPosters: { flexDirection: 'row', height: '100%' },
  heroPoster: { flex: 1, height: '100%', opacity: 0.85 },

  // Pulled up over the hero so the avatar straddles the two.
  identity: { alignItems: 'center', marginTop: -44, paddingBottom: 18, paddingHorizontal: 20 },
  avatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: '#FFFFFF' },
  avatarFallback: { backgroundColor: '#E0E7FF', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 28, fontFamily: 'Inter_700Bold', color: '#4F46E5' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  badgeText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: '#6B7280' },

  connectionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  connectionsText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#6B7280' },
  connectionsValue: { fontFamily: 'Inter_700Bold', color: '#111827' },
  connectionsDot: { fontSize: 13, color: '#D1D5DB' },

  relationshipText: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: '#6B7280',
    textAlign: 'center', marginTop: 10, paddingHorizontal: 24, lineHeight: 18,
  },
  usernameRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  username: { fontSize: 19, fontFamily: 'Inter_700Bold', color: '#111827' },

  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  followBtn: {
    marginTop: 16, backgroundColor: '#0066FF',
    paddingHorizontal: 28, paddingVertical: 9, borderRadius: 20,
  },
  followBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  followingBtn: { backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  followingBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#374151' },
  messageBtn: {
    marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20,
    borderWidth: 1, borderColor: '#0066FF',
  },
  messageBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#0066FF' },

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
  horizontalList: { paddingHorizontal: 20, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF', paddingHorizontal: 20 },
  quietText: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: '#9CA3AF',
    paddingHorizontal: 20, marginTop: 28, textAlign: 'center', lineHeight: 19,
  },

  filmCard: { width: 96 },
  filmPoster: { width: 96, height: 144, borderRadius: 8, backgroundColor: '#F3F4F6' },
  filmPosterFallback: { alignItems: 'center', justifyContent: 'center' },
  filmTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#111827', marginTop: 6 },
  filmMeta: { fontSize: 11, fontFamily: 'Inter_500Medium', color: '#FF8C00', marginTop: 1 },

  reviewRow: {
    flexDirection: 'row', gap: 12,
    marginHorizontal: 20, marginBottom: 12,
    padding: 12, borderRadius: 12, backgroundColor: '#F9FAFB',
  },
  reviewPoster: { width: 44, height: 66, borderRadius: 6, backgroundColor: '#F3F4F6' },
  reviewBody: { flex: 1 },
  reviewFilm: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#111827' },
  reviewText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#4B5563', marginTop: 3, lineHeight: 18 },

  privateNotice: {
    marginHorizontal: 20, marginTop: 24, padding: 20, borderRadius: 12,
    backgroundColor: '#F9FAFB', alignItems: 'center', gap: 10,
  },
  privateNoticeText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#6B7280', textAlign: 'center', lineHeight: 19 },
});
