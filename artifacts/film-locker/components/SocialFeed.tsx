/**
 * The social feed — what the people you follow have been doing to films.
 *
 * Ordering is the server's: anything new since the viewer's last look comes
 * first, then the rest newest-first. This side's job is to make that visible
 * rather than mysterious, which is what the two section labels are for — a
 * feed that silently reorders itself reads as broken.
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
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  useGetFeed,
  getGetFeedQueryKey,
  useMarkFeedSeen,
  type FeedItem,
} from '@workspace/api-client-react';
import { FilmDetailModal } from '@/components/FilmDetailModal';

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function stars(rating: number | null | undefined): string | null {
  if (typeof rating !== 'number' || rating < 1) return null;
  return '★'.repeat(Math.min(rating, 5));
}

/** What they did, as a sentence fragment following their name. */
function verbFor(item: FeedItem): string {
  if (item.type === 'watched') return 'watched';
  if (item.type === 'rated') return 'rated';
  return 'reviewed';
}

function FeedCard({
  item,
  onOpenFilm,
  onOpenUser,
}: {
  item: FeedItem;
  onOpenFilm: () => void;
  onOpenUser: () => void;
}) {
  const initials = (item.user.displayInitials || item.user.username || '?').slice(0, 5).toUpperCase();
  const score = stars(item.rating);

  return (
    <TouchableOpacity style={styles.card} onPress={onOpenFilm} activeOpacity={0.8}>
      {item.posterUrl ? (
        <Image source={{ uri: item.posterUrl }} style={styles.poster} contentFit="cover" />
      ) : (
        <View style={[styles.poster, styles.posterFallback]}>
          <Ionicons name="film-outline" size={20} color="#9CA3AF" />
        </View>
      )}

      <View style={styles.cardBody}>
        <View style={styles.actorRow}>
          <TouchableOpacity onPress={onOpenUser} activeOpacity={0.7} hitSlop={6}>
            {item.user.avatarUrl ? (
              <Image source={{ uri: item.user.avatarUrl }} style={styles.actorAvatar} contentFit="cover" />
            ) : (
              <View style={[styles.actorAvatar, styles.actorAvatarFallback]}>
                <Text style={styles.actorInitials} numberOfLines={1} adjustsFontSizeToFit>
                  {initials}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.actorText} numberOfLines={1}>
            <Text style={styles.actorName} onPress={onOpenUser}>
              {item.user.username ?? 'Someone'}
            </Text>
            {` ${verbFor(item)}`}
          </Text>
          {item.isNew ? (
            <View style={styles.newPill}>
              <Text style={styles.newPillText}>NEW</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.filmTitle} numberOfLines={2}>
          {item.title ?? 'Unknown film'}
          {item.releaseYear ? <Text style={styles.filmYear}>{`  ${item.releaseYear}`}</Text> : null}
        </Text>

        {item.comment ? (
          <Text style={styles.comment} numberOfLines={3}>
            “{item.comment}”
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          {score ? <Text style={styles.score}>{score}</Text> : null}
          <Text style={styles.time}>{relative(item.at)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export function SocialFeedView() {
  const router = useRouter();
  const [selected, setSelected] = useState<FeedItem | null>(null);

  const { data, isLoading, refetch, isRefetching } = useGetFeed(undefined, {
    query: { queryKey: getGetFeedQueryKey(), refetchOnMount: 'always' },
  });
  const { mutate: markSeen } = useMarkFeedSeen();

  const items = data?.items ?? [];
  const newCount = data?.newCount ?? 0;

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

  const renderItem = useCallback(
    ({ item, index }: { item: FeedItem; index: number }) => (
      <>
        {/* The boundary between the two orderings, named. Without it the
            feed looks as though it has simply lost chronological order. */}
        {newCount > 0 && index === newCount ? (
          <Text style={styles.sectionLabel}>Earlier</Text>
        ) : null}
        <FeedCard
          item={item}
          onOpenFilm={() => setSelected(item)}
          onOpenUser={() => router.push(`/user/${item.user.clerkId}`)}
        />
      </>
    ),
    [newCount, router]
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0066FF" />
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        ListHeaderComponent={
          newCount > 0 ? (
            <Text style={styles.sectionLabel}>
              {newCount === 1 ? '1 new' : `${newCount} new`} since you last looked
            </Text>
          ) : null
        }
        contentContainerStyle={items.length === 0 ? { flex: 1 } : { paddingBottom: 24 }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#0066FF" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="film-outline" size={52} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyText}>
              Follow people and this fills with what they watch, rate and review. Films they have
              watched need you both to follow each other.
            </Text>
          </View>
        }
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
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  sectionLabel: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: '#9CA3AF',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
  },

  card: {
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 10,
    borderRadius: 14,
    backgroundColor: '#F9FAFB',
  },
  poster: { width: 62, height: 93, borderRadius: 8, backgroundColor: '#F3F4F6' },
  posterFallback: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, justifyContent: 'center' },

  actorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actorAvatar: { width: 22, height: 22, borderRadius: 11 },
  actorAvatarFallback: { backgroundColor: '#E0E7FF', alignItems: 'center', justifyContent: 'center' },
  actorInitials: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#4F46E5' },
  actorText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: '#6B7280' },
  actorName: { fontFamily: 'Inter_700Bold', color: '#111827' },

  newPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#0066FF',
  },
  newPillText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#FFFFFF', letterSpacing: 0.5 },

  filmTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#111827', marginTop: 5 },
  filmYear: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },
  comment: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#4B5563',
    marginTop: 3,
    lineHeight: 17,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  score: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#FF8C00' },
  time: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#111827' },
  emptyText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 19,
  },
});
