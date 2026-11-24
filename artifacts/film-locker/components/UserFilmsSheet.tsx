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
import React, { useCallback, useEffect, useState } from 'react';
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
import {
  useLockerStatusByTitle,
  titleKey,
  asMediaType,
  furtherLockerStatus,
  type LockerStatus,
} from '@/hooks/useLockerTitles';
import { FilmDetailModal } from '@/components/FilmDetailModal';
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

function UserFilmRow({
  movie,
  lockerStatus,
  onAdded,
  onOpen,
}: {
  movie: Movie;
  /**
   * Where this title sits in the VIEWER's locker — saved, watched, or
   * not there at all.
   *
   * A status rather than a boolean. This is somebody else's locker, so a
   * good share of it is normally already in your own, and the row used to
   * say only "Added" for both halves — so a film you had already SEEN was
   * indistinguishable from one sitting unwatched on your list, which is
   * the single most useful thing to know while reading somebody's
   * watchlist.
   */
  lockerStatus: LockerStatus;
  onAdded: () => void;
  onOpen: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { mutateAsync: addMovie, isPending } = useAddMovie();
  // Only ever ahead of the server, for the moment between the write and
  // the refetch; lockerStatus covers everything this session did not do.
  // Taking the FURTHER of the two is what stops a just-added film
  // flickering back from "On your list" to nothing, and stops it
  // overwriting a "Watched" the server already knew about.
  const [justAdded, setJustAdded] = useState(false);
  const status = furtherLockerStatus(justAdded ? 'watchlist' : null, lockerStatus);
  const added = status !== null;

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
    <TouchableOpacity style={styles.row} onPress={onOpen} activeOpacity={0.75}>
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
        // Same two answers, and the same two colours, as the badge on a
        // poster: a tick in the primary blue for something seen, a
        // bookmark in the star amber for something saved.
        <View style={styles.addedPill}>
          <Ionicons
            name={status === 'watched' ? 'checkmark' : 'bookmark'}
            size={13}
            color={status === 'watched' ? colors.primary : colors.star}
          />
          <Text
            style={[
              styles.addedText,
              { color: status === 'watched' ? colors.primary : colors.star },
            ]}
          >
            {status === 'watched' ? 'Watched' : 'On your list'}
          </Text>
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
    </TouchableOpacity>
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

  /** The row tapped open, or null. Cleared when the sheet is dismissed. */
  const [openFilm, setOpenFilm] = useState<Movie | null>(null);
  useEffect(() => {
    if (!visible) setOpenFilm(null);
  }, [visible]);

  return (
    <>
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
              <UserFilmRow
                movie={item}
                lockerStatus={lockerStatusByTitle.get(titleKey(item)) ?? null}
                onAdded={() => {}}
                onOpen={() => setOpenFilm(item)}
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

    {/* A SIBLING of the Modal above, never a child. A Modal nested inside
        another Modal is unreliable on Android and has already produced a
        blank-sheet bug in this codebase (see ShareFilmSheet).

        savedMovie is deliberately not passed: these rows are somebody
        ELSE'S locker row, and the sheet finds the viewer's own from the
        shared movies query. Nor is sourceUrl — the post they were reading
        is theirs, and the endpoint does not send it. */}
    {openFilm ? (
      <FilmDetailModal
        visible
        onClose={() => setOpenFilm(null)}
        tmdbId={openFilm.tmdbId}
        mediaType={asMediaType(openFilm.mediaType)}
        title={openFilm.title}
        posterUrl={openFilm.posterUrl}
        releaseYear={openFilm.releaseYear}
        overview={openFilm.overview}
      />
    ) : null}
    </>
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
