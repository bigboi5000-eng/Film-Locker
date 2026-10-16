/**
 * The social feed — what people have been doing to films.
 *
 * Two populations, as the server orders them: the people you follow first,
 * then public accounts who have rated or reviewed something already in your
 * locker. Unseen before seen within each. This side's job is to make those
 * boundaries visible rather than mysterious, which is what the section
 * labels are for — a feed that silently reorders itself reads as broken.
 *
 * Cards are full-bleed rather than inset. A poster is the thing worth
 * looking at and an inset card with a thumbnail makes it furniture; the
 * layout is the one every feed converges on because it works — who did it,
 * the artwork, what they said, what you can do about it.
 *
 * The watermark is advanced on the way out, with the timestamp of the newest
 * item that was actually on screen rather than with the present moment. An
 * item that arrived while the feed sat open has not been seen, and stamping
 * now() would bury it unread.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetFeed,
  getGetFeedQueryKey,
  useMarkFeedSeen,
  useAddMovie,
  getListMoviesQueryKey,
  type FeedItem,
} from '@workspace/api-client-react';
import { FilmDetailModal } from '@/components/FilmDetailModal';
import { StarRating, formatStars } from '@/components/StarRating';
import { ShareToFriendSheet } from '@/components/ShareToFriendSheet';
import { useToast } from '@/components/ToastProvider';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

/**
 * The artwork band, as a share of the screen.
 *
 * A quarter, which is what a poster needs to be the thing you look at
 * without a single card filling the screen and turning a feed into a
 * slideshow. Measured once: this does not need to survive a rotation, and
 * the app is portrait-locked anyway.
 */
const ART_HEIGHT = Math.round(Dimensions.get('window').height * 0.25);

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

/** What they did, as a sentence fragment following their name. */
function verbFor(item: FeedItem): string {
  if (item.type === 'watched') return 'watched';
  if (item.type === 'rated') return 'rated';
  if (item.type === 'playlist') return 'made a playlist';
  return 'reviewed';
}

function FeedCard({
  item,
  onOpenFilm,
  onOpenUser,
  onShare,
}: {
  item: FeedItem;
  onOpenFilm: () => void;
  onOpenUser: () => void;
  onShare: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { mutateAsync: addMovie } = useAddMovie();

  /** Which of the two save actions has been taken on this card. */
  const [saved, setSaved] = useState<'watchlist' | 'watched' | null>(null);
  const [busy, setBusy] = useState(false);

  const initials = (item.user.displayInitials || item.user.username || '?')
    .slice(0, 5)
    .toUpperCase();
  const isPlaylist = item.type === 'playlist';
  // A film the resolver could not name cannot be saved — there would be
  // nothing to put in the locker but a TMDB id.
  const canSave = !isPlaylist && item.tmdbId != null && item.title != null;

  const save = useCallback(
    async (asWatched: boolean) => {
      if (!canSave || busy) return;
      setBusy(true);
      try {
        await addMovie({
          data: {
            tmdbId: item.tmdbId!,
            title: item.title!,
            releaseYear: item.releaseYear ?? '',
            posterUrl: item.posterUrl ?? '',
            overview: '',
            isWatched: asWatched,
          },
        });
        setSaved(asWatched ? 'watched' : 'watchlist');
        if (Platform.OS !== 'web') {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        showToast({
          title: asWatched ? 'Marked as watched' : 'Added to your watchlist',
          subtitle: item.title ?? undefined,
        });
        void queryClient.invalidateQueries({ queryKey: getListMoviesQueryKey() });
      } catch {
        showToast({ title: 'Could not save that film', variant: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [addMovie, busy, canSave, item, queryClient, showToast]
  );

  return (
    <View style={styles.card}>
      {/* Who, above the artwork. */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onOpenUser} activeOpacity={0.7} hitSlop={6}>
          {item.user.avatarUrl ? (
            <Image source={{ uri: item.user.avatarUrl }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitials} numberOfLines={1} adjustsFontSizeToFit>
                {initials}
              </Text>
            </View>
          )}
        </TouchableOpacity>
        <Text style={styles.headerText} numberOfLines={1}>
          <Text style={styles.headerName} onPress={onOpenUser}>
            {item.user.username ?? 'Someone'}
          </Text>
          {` ${verbFor(item)}`}
        </Text>
        {item.isNew ? <View style={styles.newDot} /> : null}
        <Text style={styles.headerTime}>{relative(item.at)}</Text>
      </View>

      {/* The artwork. */}
      <TouchableOpacity activeOpacity={0.9} onPress={onOpenFilm}>
        <View style={styles.art}>
          {isPlaylist ? (
            <View style={styles.collage}>
              {(item.playlistPosters ?? []).slice(0, 4).map((uri, i) => (
                <Image key={i} source={{ uri }} style={styles.collageTile} contentFit="cover" />
              ))}
            </View>
          ) : item.posterUrl ? (
            // Anchored to the top: a poster cropped to a landscape band
            // loses its title from the middle, and the title is usually in
            // the upper half.
            <Image
              source={{ uri: item.posterUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              contentPosition="top"
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.artFallback]}>
              <Ionicons name="film-outline" size={34} color={colors.iconFaint} />
            </View>
          )}

          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.78)']}
            style={styles.artScrim}
            pointerEvents="none"
          />
          <View style={styles.artCaption} pointerEvents="none">
            <Text style={styles.artTitle} numberOfLines={1}>
              {isPlaylist ? item.playlistName ?? 'Untitled playlist' : item.title ?? 'Unknown film'}
            </Text>
            <Text style={styles.artMeta} numberOfLines={1}>
              {isPlaylist
                ? item.playlistItemCount === 1
                  ? '1 film'
                  : `${item.playlistItemCount ?? 0} films`
                : item.releaseYear ?? ''}
            </Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* What they actually said about it. */}
      {item.comment ? (
        <Text style={styles.comment} numberOfLines={4}>
          {item.comment}
        </Text>
      ) : typeof item.rating === 'number' && item.rating > 0 ? (
        <View style={styles.ratingRow}>
          <StarRating value={item.rating} size={15} gap={1} />
          <Text style={styles.ratingText}>{formatStars(item.rating)}/5</Text>
        </View>
      ) : null}

      {/* What you can do about it. Hidden on a playlist, which is not a film
          and has nothing to save. */}
      {isPlaylist ? null : (
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.action}
            onPress={() => save(false)}
            disabled={!canSave || busy || saved !== null}
            activeOpacity={0.7}
          >
            <Ionicons
              name={saved === 'watchlist' ? 'bookmark' : 'bookmark-outline'}
              size={19}
              color={saved === 'watchlist' ? colors.primary : canSave ? colors.textMuted : colors.iconFaint}
            />
            <Text
              style={[
                styles.actionText,
                saved === 'watchlist' && styles.actionTextDone,
                !canSave && styles.actionTextOff,
              ]}
            >
              {saved === 'watchlist' ? 'Saved' : 'Watchlist'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.action}
            onPress={() => save(true)}
            disabled={!canSave || busy || saved !== null}
            activeOpacity={0.7}
          >
            <Ionicons
              name={saved === 'watched' ? 'checkmark-circle' : 'checkmark-circle-outline'}
              size={19}
              color={saved === 'watched' ? colors.success : canSave ? colors.textMuted : colors.iconFaint}
            />
            <Text
              style={[
                styles.actionText,
                saved === 'watched' && styles.actionTextDone,
                !canSave && styles.actionTextOff,
              ]}
            >
              {saved === 'watched' ? 'Watched' : 'Mark watched'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.action}
            onPress={onShare}
            disabled={!canSave}
            activeOpacity={0.7}
          >
            <Ionicons
              name="paper-plane-outline"
              size={18}
              color={canSave ? colors.textMuted : colors.iconFaint}
            />
            <Text style={[styles.actionText, !canSave && styles.actionTextOff]}>Share</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export function SocialFeedView() {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const colors = useColors();

  /** Only ever a film item — a playlist card navigates instead. */
  const [selected, setSelected] = useState<FeedItem | null>(null);
  const [sharing, setSharing] = useState<FeedItem | null>(null);

  const { data, isLoading, refetch, isRefetching } = useGetFeed(undefined, {
    query: { queryKey: getGetFeedQueryKey(), refetchOnMount: 'always' },
  });
  const { mutate: markSeen } = useMarkFeedSeen();

  const items = data?.items ?? [];
  const newCount = data?.newCount ?? 0;

  const open = useCallback(
    (item: FeedItem) => {
      if (item.type === 'playlist') {
        if (item.playlistId != null) {
          router.push({ pathname: '/playlist/[id]', params: { id: String(item.playlistId) } });
        }
        return;
      }
      if (item.tmdbId != null) setSelected(item);
    },
    [router]
  );

  /**
   * The high-water mark to report on the way out.
   *
   * Held in a ref and read only in the cleanup, so the effect does not need
   * the data as a dependency — it would otherwise report on every refetch
   * rather than once, when leaving.
   */
  const newestRef = useRef<string | null>(null);
  if (items.length > 0) {
    const newest = items.reduce((a, b) => (new Date(b.at) > new Date(a.at) ? b : a));
    newestRef.current = newest.at;
  }

  const markSeenRef = useRef(markSeen);
  useEffect(() => { markSeenRef.current = markSeen; }, [markSeen]);

  /**
   * Reported on the way out — on leaving the Community tab as well as on
   * switching away from this sub-tab, which is what useFocusEffect's
   * cleanup covers and a plain unmount effect does not: the tab screens
   * stay mounted, so going to Home would otherwise never advance the
   * watermark and everything would stay marked new for good.
   */
  useFocusEffect(
    useCallback(() => {
      return () => {
        const at = newestRef.current;
        // Fire and forget: a failed watermark costs a second look at items
        // the viewer has already read, which is a far better failure than
        // burying something unread.
        if (at) markSeenRef.current({ data: { at } });
      };
    }, [])
  );

  /**
   * The label above an item, where it starts a new group.
   *
   * Three boundaries matter and all three are derivable from the item and
   * the one before it: the top of the feed, the end of the unseen run, and
   * the point where people you follow give way to everybody else.
   */
  const labelFor = useCallback((item: FeedItem, previous: FeedItem | undefined): string | null => {
    if (!previous) {
      if (item.fromFollowed) {
        return item.isNew ? `${newCount === 1 ? '1 new' : `${newCount} new`} since you last looked` : 'From people you follow';
      }
      return 'On films in your locker';
    }
    if (previous.fromFollowed && !item.fromFollowed) return 'On films in your locker';
    if (previous.isNew && !item.isNew && item.fromFollowed) return 'Earlier';
    return null;
  }, [newCount]);

  const renderItem = useCallback(
    ({ item, index }: { item: FeedItem; index: number }) => {
      const label = labelFor(item, index > 0 ? items[index - 1] : undefined);
      return (
        <>
          {label ? <Text style={styles.sectionLabel}>{label}</Text> : null}
          <FeedCard
            item={item}
            onOpenFilm={() => open(item)}
            onOpenUser={() => router.push(`/user/${item.user.clerkId}`)}
            onShare={() => setSharing(item)}
          />
        </>
      );
    },
    [items, labelFor, open, router, styles.sectionLabel]
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={items.length === 0 ? { flex: 1 } : { paddingBottom: 24 }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="film-outline" size={52} color={colors.iconFaint} />
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyText}>
              Follow people and this fills with what they watch, rate, review and put in public
              playlists — plus anybody public who has written about a film you have saved.
            </Text>
          </View>
        }
      />

      {selected?.tmdbId != null && (
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

      {sharing?.tmdbId != null && (
        <ShareToFriendSheet
          visible
          onClose={() => setSharing(null)}
          tmdbId={sharing.tmdbId}
          filmTitle={sharing.title ?? ''}
          posterUrl={sharing.posterUrl ?? ''}
        />
      )}
    </>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  sectionLabel: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: c.textFaint,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 10,
  },

  // Full-bleed: no horizontal margin, and separated by a line rather than
  // by a gap, so the artwork runs edge to edge.
  card: { paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },

  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  avatar: { width: 30, height: 30, borderRadius: 15 },
  avatarFallback: { backgroundColor: c.avatarBg, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 11, fontFamily: 'Inter_700Bold', color: c.avatarFg },
  headerText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: c.textMuted },
  headerName: { fontFamily: 'Inter_700Bold', color: c.text },
  newDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.primary },
  headerTime: { fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textFaint },

  art: { width: '100%', height: ART_HEIGHT, backgroundColor: c.surfaceAlt, overflow: 'hidden' },
  artFallback: { alignItems: 'center', justifyContent: 'center' },
  artScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 96 },
  artCaption: { position: 'absolute', left: 14, right: 14, bottom: 10 },
  artTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  artMeta: { fontSize: 12, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.78)', marginTop: 1 },

  collage: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', flexWrap: 'wrap' },
  collageTile: { width: '50%', height: '50%' },

  comment: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: c.textBody,
    lineHeight: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingTop: 10 },
  ratingText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.textMuted },

  actions: { flexDirection: 'row', paddingHorizontal: 6, paddingTop: 8 },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  actionText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: c.textMuted },
  actionTextDone: { color: c.text },
  actionTextOff: { color: c.iconFaint },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: c.text },
  emptyText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: c.textFaint,
    textAlign: 'center',
    lineHeight: 19,
  },
});
