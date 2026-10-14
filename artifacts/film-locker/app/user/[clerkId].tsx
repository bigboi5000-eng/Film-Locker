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
 *
 * The one exception is the preview on your own profile. Viewing yourself,
 * the server hands over everything — correctly, it is your data — so the
 * screen applies a visitor's rules itself to answer "what does this look
 * like to someone who has just found me". It can do that honestly because
 * the rules are not a judgement call: nobody who does not follow you is a
 * Film Pal, so watched films are always hidden, and a private account hides
 * everything else as well.
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
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

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
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity style={styles.filmCard} onPress={onPress} activeOpacity={0.8}>
      {film.posterUrl ? (
        <Image source={{ uri: film.posterUrl }} style={styles.filmPoster} contentFit="cover" />
      ) : (
        <View style={[styles.filmPoster, styles.filmPosterFallback]}>
          <Ionicons name="film-outline" size={22} color={colors.textFaint} />
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
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { clerkId } = useLocalSearchParams<{ clerkId: string }>();

  const [busy, setBusy] = useState(false);
  const [watchedVisible, setWatchedVisible] = useState(false);
  /** On your own profile: render it as somebody who does not follow you. */
  const [preview, setPreview] = useState(false);
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
    if (!data) return out;

    // Previewing has to reach the hero as well, or the band keeps showing
    // films the visitor it is imitating would never be shown.
    const asVisitor = data.followStatus === 'self' && preview;
    if (!asVisitor) for (const f of data.recentWatched ?? []) push(f.posterUrl);
    if (!(asVisitor && data.user.isPrivate)) {
      for (const f of data.recentRatings ?? []) push(f.posterUrl);
      for (const pl of data.publicPlaylists ?? []) (pl.coverPosters ?? []).forEach(push);
    }
    return out;
  }, [data, preview]);

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
          <ActivityIndicator color={colors.primary} size="large" />
        ) : (
          <>
            <Ionicons name="person-outline" size={40} color={colors.iconFaint} />
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
  const isSelf = followStatus === 'self';

  /**
   * What a stranger would be shown, when previewing.
   *
   * Watched films need a mutual follow, so they are hidden for any visitor
   * who does not already follow you — which is everyone this preview is
   * about. A private account hides the rest too, and gets the same notice a
   * real visitor gets.
   */
  const asVisitor = isSelf && preview;
  const hideAll = asVisitor && user.isPrivate;
  const shownWatched = asVisitor ? null : recentWatched;
  const shownRatings = hideAll ? null : recentRatings;
  const shownComments = hideAll ? null : recentComments;
  const shownPlaylists = hideAll ? null : publicPlaylists;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
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
            colors={['rgba(17,24,39,0.35)', 'rgba(17,24,39,0.82)', colors.background]}
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
            <Ionicons name={user.isPrivate ? 'lock-closed' : 'earth'} size={12} color={colors.textMuted} />
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

          {/* Your own profile, which is reachable from Settings. Without this
              it is indistinguishable from someone else's — same layout, and
              the only tell is the absence of a Follow button. */}
          {isSelf && (
            <View style={styles.selfBanner}>
              <Text style={styles.selfBannerText}>
                {preview
                  ? user.isPrivate
                    ? 'This is all someone who doesn’t follow you can see. Your account is private.'
                    : 'This is what someone who doesn’t follow you sees. Watched films stay hidden until you follow each other.'
                  : 'This is your profile — the page other people open.'}
              </Text>
              <TouchableOpacity
                style={styles.previewBtn}
                onPress={() => setPreview((p) => !p)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={preview ? 'eye-off-outline' : 'eye-outline'}
                  size={15}
                  color={colors.primary}
                />
                <Text style={styles.previewBtnText}>
                  {preview ? 'Back to your view' : 'Preview as a visitor'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Previewing shows the control a visitor would be offered, inert.
              Worth seeing rather than describing: on a private account it
              reads "Request" rather than "Follow", which is the thing people
              are usually checking. */}
          {asVisitor && (
            <View style={[styles.followBtn, styles.inertBtn]} pointerEvents="none">
              <Text style={styles.inertBtnText}>{user.isPrivate ? 'Request' : 'Follow'}</Text>
            </View>
          )}

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
                <ActivityIndicator color={colors.primary} style={{ marginTop: 14 }} />
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
                  <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.primary} />
                  <Text style={styles.messageBtnText}>Message</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Headline stats */}
        <View style={styles.statsRow}>
          {(isSelf && !preview) || isFilmPal ? (
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
        {shownPlaylists === null && shownRatings === null ? (
          <View style={styles.privateNotice}>
            <Ionicons name="lock-closed-outline" size={22} color={colors.textFaint} />
            <Text style={styles.privateNoticeText}>
              {isSelf
                ? 'Your account is private, so this is where a visitor stops. Everything below is hidden until you accept them.'
                : `This account is private. Follow ${them} to see what they have been watching, rating and recommending.`}
            </Text>
          </View>
        ) : null}

        {shownWatched && shownWatched.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recently watched</Text>
            <FlatList
              data={shownWatched}
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

        {shownRatings && shownRatings.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Rated</Text>
            <FlatList
              data={shownRatings}
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

        {shownComments && shownComments.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reviews</Text>
            {shownComments.map((c) => (
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
                    <Ionicons name="film-outline" size={18} color={colors.textFaint} />
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
        {shownPlaylists !== null ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Playlists</Text>
            {shownPlaylists.length === 0 ? (
              <Text style={styles.emptyText}>No public playlists yet.</Text>
            ) : (
              <FlatList
                data={shownPlaylists}
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
        {shownPlaylists !== null &&
        shownPlaylists.length === 0 &&
        (shownRatings?.length ?? 0) === 0 &&
        (shownComments?.length ?? 0) === 0 &&
        (shownWatched?.length ?? 0) === 0 ? (
          <Text style={styles.quietText}>
            {isSelf
              ? 'Nothing to show yet. Rate a film or make a playlist public and it appears here.'
              : `${user.username ?? 'This person'} hasn’t rated or reviewed anything yet.`}
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

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  centerFill: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  notFoundText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: c.textFaint },
  backLink: { marginTop: 16 },
  backLinkText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: c.primary },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  backBtn: { padding: 4, marginRight: 12 },
  headerTitle: { flex: 1, fontSize: 18, fontFamily: 'Inter_700Bold', color: c.text },

  hero: { height: 150, backgroundColor: c.heroBackdrop, overflow: 'hidden' },
  heroPosters: { flexDirection: 'row', height: '100%' },
  heroPoster: { flex: 1, height: '100%', opacity: 0.85 },

  // Pulled up over the hero so the avatar straddles the two.
  identity: { alignItems: 'center', marginTop: -44, paddingBottom: 18, paddingHorizontal: 20 },
  avatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: c.background },
  avatarFallback: { backgroundColor: c.avatarBg, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 28, fontFamily: 'Inter_700Bold', color: c.avatarFg },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  badgeText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: c.textMuted },

  connectionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  connectionsText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: c.textMuted },
  connectionsValue: { fontFamily: 'Inter_700Bold', color: c.text },
  connectionsDot: { fontSize: 13, color: c.iconFaint },

  relationshipText: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: c.textMuted,
    textAlign: 'center', marginTop: 10, paddingHorizontal: 24, lineHeight: 18,
  },
  usernameRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  username: { fontSize: 19, fontFamily: 'Inter_700Bold', color: c.text },

  selfBanner: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: c.surfaceSubtle,
    alignItems: 'center',
    gap: 8,
  },
  selfBannerText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: c.textMuted,
    textAlign: 'center',
    lineHeight: 17,
  },
  previewBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  previewBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.primary },

  inertBtn: { backgroundColor: c.border },
  inertBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: c.textFaint },

  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  followBtn: {
    marginTop: 16, backgroundColor: c.primary,
    paddingHorizontal: 28, paddingVertical: 9, borderRadius: 20,
  },
  followBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: c.background },
  followingBtn: { backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border },
  followingBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: c.textStrong },
  messageBtn: {
    marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20,
    borderWidth: 1, borderColor: c.primary,
  },
  messageBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: c.primary },

  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 20, paddingVertical: 16,
    backgroundColor: c.surfaceSubtle, borderRadius: 14,
  },
  statTile: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontFamily: 'Inter_700Bold', color: c.text },
  statLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textFaint, marginTop: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: c.border },

  section: { marginTop: 28 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: c.text, paddingHorizontal: 20, marginBottom: 12 },
  horizontalList: { paddingHorizontal: 20, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: c.textFaint, paddingHorizontal: 20 },
  quietText: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: c.textFaint,
    paddingHorizontal: 20, marginTop: 28, textAlign: 'center', lineHeight: 19,
  },

  filmCard: { width: 96 },
  filmPoster: { width: 96, height: 144, borderRadius: 8, backgroundColor: c.surfaceAlt },
  filmPosterFallback: { alignItems: 'center', justifyContent: 'center' },
  filmTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: c.text, marginTop: 6 },
  filmMeta: { fontSize: 11, fontFamily: 'Inter_500Medium', color: c.star, marginTop: 1 },

  reviewRow: {
    flexDirection: 'row', gap: 12,
    marginHorizontal: 20, marginBottom: 12,
    padding: 12, borderRadius: 12, backgroundColor: c.surfaceSubtle,
  },
  reviewPoster: { width: 44, height: 66, borderRadius: 6, backgroundColor: c.surfaceAlt },
  reviewBody: { flex: 1 },
  reviewFilm: { fontSize: 13, fontFamily: 'Inter_700Bold', color: c.text },
  reviewText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: c.textBody, marginTop: 3, lineHeight: 18 },

  privateNotice: {
    marginHorizontal: 20, marginTop: 24, padding: 20, borderRadius: 12,
    backgroundColor: c.surfaceSubtle, alignItems: 'center', gap: 10,
  },
  privateNoticeText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: c.textMuted, textAlign: 'center', lineHeight: 19 },
});
