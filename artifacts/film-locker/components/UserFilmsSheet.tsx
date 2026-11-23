/**
 * UserFilmsSheet
 *
 * Full-screen list of one half of another user's locker — what they have
 * watched, or what they have saved to watch. Each row has an "Add to
 * Watchlist" button on the right, so something off their list can go
 * straight into yours.
 *
 * One component for both because they differ only in which endpoint they
 * read and what the header says; the row, the already-in-your-locker
 * check and the add button are identical. What is NOT identical is who
 * may open them, and that is not this component's business — the server
 * decides, and the two endpoints are gated differently:
 *
 *   watched   — mutual follow ("Film Pals"), the strictest bar in the app
 *   watchlist — a public account, or an accepted follow on a private one
 *
 * so the profile screen only offers the tap when the viewer qualifies.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, FlatList,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetUserWatched,
  getGetUserWatchedQueryKey,
  useGetUserWatchlist,
  getGetUserWatchlistQueryKey,
  useAddMovie,
  getListMoviesQueryKey,
  type Movie,
} from '@workspace/api-client-react';
import { useToast } from '@/components/ToastProvider';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import { useLockerStatusByTitle, titleKey, asMediaType } from '@/hooks/useLockerTitles';
import type { Palette } from '@/constants/colors';

/** Which half of the locker this sheet is showing. */
export type UserFilmsMode = 'watched' | 'watchlist';

interface UserFilmsSheetProps {
  visible: boolean;
  mode: UserFilmsMode;
  clerkId: string;
  username: string;
  onClose: () => void;
}

function WatchedFilmRow({
  movie,
  alreadyInLocker,
  onAdded,
}: {
  movie: Movie;
  /**
   * Whether the VIEWER already has this film, watchlist or watched.
   *
   * This is somebody else's locker, so a good share of it is normally
   * already in your own — and without this the row offered to add every
   * one of them, including the ones you had seen yourself.
   */
  alreadyInLocker: boolean;
  onAdded: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { mutateAsync: addMovie, isPending } = useAddMovie();
  // Only ever ahead of the server, for the moment between the write and
  // the refetch; alreadyInLocker covers everything this session did not do.
  const [justAdded, setJustAdded] = useState(false);
  const added = justAdded || alreadyInLocker;

  const handleAdd = useCallback(async () => {
    if (added || isPending) return;
    try {
      await addMovie({
        data: {
          tmdbId: movie.tmdbId,
          mediaType: asMediaType(movie.mediaType),
          title: movie.title,
          releaseYear: movie.releaseYear,
          posterUrl: movie.posterUrl,
          overview: movie.overview,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListMoviesQueryKey() });
      setJustAdded(true);
      onAdded();
    } catch {
      showToast({ title: 'Could not add film', subtitle: 'Check your connection and try again.', variant: 'error' });
    }
  }, [added, isPending, addMovie, movie, queryClient, showToast, onAdded]);

  return (
    <View style={styles.row}>
      {movie.posterUrl ? (
        <Image source={{ uri: movie.posterUrl }} style={styles.poster} contentFit="cover" />
      ) : (
        <View style={[styles.poster, styles.posterFallback]}>
          <Ionicons name="film-outline" size={18} color={colors.iconFaint} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{movie.title}</Text>
        {movie.releaseYear ? <Text style={styles.year}>{movie.releaseYear}</Text> : null}
      </View>
      {added ? (
        <View style={styles.addedPill}>
          <Ionicons name="checkmark" size={14} color={colors.success} />
          <Text style={styles.addedText}>Added</Text>
        </View>
      ) : (
        <TouchableOpacity style={styles.addBtn} onPress={handleAdd} disabled={isPending} activeOpacity={0.8}>
          {isPending ? (
            <ActivityIndicator size="small" color={colors.onColor} />
          ) : (
            <Text style={styles.addBtnText}>Add to Watchlist</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

export function UserFilmsSheet({ visible, mode, clerkId, username, onClose }: UserFilmsSheetProps) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  // Both hooks are called unconditionally — hooks cannot be called behind
  // a branch — and the one for the other half is disabled, so only the
  // sheet actually open makes a request.
  const watched = useGetUserWatched(clerkId, {
    query: {
      queryKey: getGetUserWatchedQueryKey(clerkId),
      enabled: visible && mode === 'watched' && Boolean(clerkId),
    },
  });
  const watchlist = useGetUserWatchlist(clerkId, {
    query: {
      queryKey: getGetUserWatchlistQueryKey(clerkId),
      enabled: visible && mode === 'watchlist' && Boolean(clerkId),
    },
  });

  const { data, isLoading } = mode === 'watched' ? watched : watchlist;
  const movies = data?.movies ?? [];
  // One shared read of the viewer's own locker for the whole sheet.
  const lockerStatusByTitle = useLockerStatusByTitle();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {mode === 'watched' ? `${username}'s Watched Films` : `${username}'s Watchlist`}
          </Text>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
        ) : (
          <FlatList
            data={movies}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            renderItem={({ item }) => (
              <WatchedFilmRow
                movie={item}
                alreadyInLocker={lockerStatusByTitle.has(titleKey(item))}
                onAdded={() => {}}
              />
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="film-outline" size={48} color={colors.iconFaint} />
                <Text style={styles.emptyText}>
                  {mode === 'watched' ? 'No watched films yet.' : 'Nothing on the watchlist yet.'}
                </Text>
              </View>
            }
          />
        )}
      </View>
    </Modal>
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
  headerTitle: { flex: 1, fontSize: 17, fontFamily: 'Inter_700Bold', color: c.text },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  poster: { width: 44, height: 64, borderRadius: 6 },
  posterFallback: { backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: c.text },
  year: { fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textFaint, marginTop: 2 },

  addBtn: { backgroundColor: c.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  addBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: c.onColor },
  addedPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addedText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: c.success },

  separator: { height: 1, backgroundColor: c.surfaceAlt, marginLeft: 72 },

  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: c.textFaint },
});
