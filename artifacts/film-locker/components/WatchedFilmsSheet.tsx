/**
 * WatchedFilmsSheet
 *
 * Full-screen list of another user's watched films — only reachable from
 * the profile screen's "Watched" stat when both accounts follow each other.
 * Each row has an "Add to Watchlist" button on the right so a film pal's
 * watched film can be added straight to your own locker.
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
  useAddMovie,
  getListMoviesQueryKey,
  type Movie,
} from '@workspace/api-client-react';
import { useToast } from '@/components/ToastProvider';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

interface WatchedFilmsSheetProps {
  visible: boolean;
  clerkId: string;
  username: string;
  onClose: () => void;
}

function WatchedFilmRow({ movie, onAdded }: { movie: Movie; onAdded: () => void }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { mutateAsync: addMovie, isPending } = useAddMovie();
  const [added, setAdded] = useState(false);

  const handleAdd = useCallback(async () => {
    if (added || isPending) return;
    try {
      await addMovie({
        data: {
          tmdbId: movie.tmdbId,
          title: movie.title,
          releaseYear: movie.releaseYear,
          posterUrl: movie.posterUrl,
          overview: movie.overview,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListMoviesQueryKey() });
      setAdded(true);
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

export function WatchedFilmsSheet({ visible, clerkId, username, onClose }: WatchedFilmsSheetProps) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useGetUserWatched(clerkId, {
    query: { queryKey: getGetUserWatchedQueryKey(clerkId), enabled: visible && Boolean(clerkId) },
  });
  const movies = data?.movies ?? [];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{username}'s Watched Films</Text>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
        ) : (
          <FlatList
            data={movies}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            renderItem={({ item }) => <WatchedFilmRow movie={item} onAdded={() => {}} />}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="film-outline" size={48} color={colors.iconFaint} />
                <Text style={styles.emptyText}>No watched films yet.</Text>
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
