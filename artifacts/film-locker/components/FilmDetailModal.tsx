import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  useGetMovieDetails,
  usePatchWatched,
  usePatchRating,
  useAddMovie,
  getListMoviesQueryKey,
  type Movie,
  type TmdbMovieCard,
  type WatchProvider,
} from '@workspace/api-client-react';

const { width: W, height: H } = Dimensions.get('window');
const POSTER_HEIGHT = H * 0.45;

interface FilmDetailModalProps {
  visible: boolean;
  onClose: () => void;
  /** TMDB ID — always required; used to fetch full detail data */
  tmdbId: number;
  /** Basic card data shown immediately while full details load */
  title: string;
  posterUrl: string;
  releaseYear: string;
  overview: string;
  /** If this movie is saved in the locker, pass the full DB record */
  savedMovie?: Movie;
}

// ── Star rating component ──────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
}: {
  value: number | null | undefined;
  onChange: (n: number) => void;
}) {
  return (
    <View style={starStyles.row}>
      {[1, 2, 3, 4, 5].map((n) => (
        <TouchableOpacity key={n} onPress={() => onChange(n)} hitSlop={8}>
          <Ionicons
            name={typeof value === 'number' && value >= n ? 'star' : 'star-outline'}
            size={28}
            color="#FF8C00"
            style={{ marginHorizontal: 4 }}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const starStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});

// ── Watch Provider pill ────────────────────────────────────────────────────────

const PROVIDER_TYPE_LABEL: Record<string, string> = {
  flatrate: 'Included',
  rent: 'Rent / Buy',
  buy: 'Rent / Buy',
};

const PROVIDER_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  flatrate: { bg: '#D1FAE5', text: '#065F46' }, // green — subscription
  rent:     { bg: '#FFF0DC', text: '#FF8C00' }, // orange — rent/buy
  buy:      { bg: '#FFF0DC', text: '#FF8C00' }, // orange — rent/buy
};

async function openProviderLink(provider: WatchProvider, movieTitle: string) {
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(
    `watch ${movieTitle} on ${provider.provider_name}`
  )}`;

  if (provider.link) {
    try {
      await Linking.openURL(provider.link);
      return;
    } catch {
      // JustWatch link failed — fall through to Google search
    }
  }

  Linking.openURL(googleUrl).catch(() => {
    Alert.alert('Unable to open link', 'Could not open the streaming service.');
  });
}

function ProviderPill({
  provider,
  movieTitle,
}: {
  provider: WatchProvider;
  movieTitle: string;
}) {
  const typeKey = provider.type ?? 'flatrate';
  const label = PROVIDER_TYPE_LABEL[typeKey] ?? typeKey;
  const colors = PROVIDER_TYPE_COLORS[typeKey] ?? PROVIDER_TYPE_COLORS.flatrate;

  return (
    <TouchableOpacity
      style={providerStyles.pill}
      onPress={() => openProviderLink(provider, movieTitle)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Watch on ${provider.provider_name} — ${label}`}
    >
      {provider.logo_url ? (
        <Image
          source={{ uri: provider.logo_url }}
          style={providerStyles.logo}
          contentFit="cover"
        />
      ) : (
        <View style={[providerStyles.logo, providerStyles.logoFallback]}>
          <Text style={providerStyles.logoFallbackText}>
            {provider.provider_name[0]}
          </Text>
        </View>
      )}
      <Text style={providerStyles.name} numberOfLines={1}>
        {provider.provider_name}
      </Text>
      <View style={[providerStyles.badge, { backgroundColor: colors.bg }]}>
        <Text style={[providerStyles.badgeText, { color: colors.text }]}>
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const providerStyles = StyleSheet.create({
  pill: { alignItems: 'center', marginRight: 14, width: 64 },
  logo: { width: 48, height: 48, borderRadius: 10, marginBottom: 4 },
  logoFallback: { backgroundColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' },
  logoFallbackText: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#6B7280' },
  name: { fontSize: 10, fontFamily: 'Inter_400Regular', color: '#6B7280', textAlign: 'center', marginBottom: 3 },
  badge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  badgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },
});

// ── Genre tag ──────────────────────────────────────────────────────────────────

function GenreTag({ label }: { label: string }) {
  return (
    <View style={tagStyles.tag}>
      <Text style={tagStyles.text}>{label}</Text>
    </View>
  );
}

const tagStyles = StyleSheet.create({
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    marginRight: 6,
    marginBottom: 6,
  },
  text: { fontSize: 12, fontFamily: 'Inter_500Medium', color: '#0066FF' },
});

// ── Main component ─────────────────────────────────────────────────────────────

export function FilmDetailModal({
  visible,
  onClose,
  tmdbId,
  title,
  posterUrl,
  releaseYear,
  overview,
  savedMovie,
}: FilmDetailModalProps) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [optimisticRating, setOptimisticRating] = useState<number | null | undefined>(undefined);
  const [optimisticWatched, setOptimisticWatched] = useState<boolean | undefined>(undefined);

  // Fetch full TMDB details — parent only renders this component when a movie
  // is selected, so the hook always runs against a valid tmdbId.
  const { data: details, isLoading } = useGetMovieDetails(tmdbId);

  const { mutateAsync: patchWatched, isPending: isWatchingPending } = usePatchWatched();
  const { mutateAsync: patchRating, isPending: isRatingPending } = usePatchRating();
  const { mutateAsync: addMovie, isPending: isAddingPending } = useAddMovie();

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: getListMoviesQueryKey() });
  }, [queryClient]);

  // Resolved values: prefer optimistic > savedMovie > details
  const currentRating =
    optimisticRating !== undefined ? optimisticRating : savedMovie?.rating ?? null;
  const currentWatched =
    optimisticWatched !== undefined ? optimisticWatched : savedMovie?.isWatched ?? false;

  const displayDirector = details?.director ?? '';
  const displayCast = details?.cast ?? [];
  const displayGenres = details?.genres ?? [];
  const displayLanguage = details?.language ?? '';
  const displayProviders = details?.watchProviders ?? [];
  const displayOverview = details?.overview || overview;

  const handleRating = useCallback(
    async (n: number) => {
      if (!savedMovie) return;
      const newRating = currentRating === n ? null : n;
      setOptimisticRating(newRating);
      if (Platform.OS !== 'web') Haptics.selectionAsync();
      try {
        await patchRating({ id: savedMovie.id, data: { rating: newRating } });
        await invalidate();
      } catch {
        setOptimisticRating(undefined);
        Alert.alert('Error', 'Could not update rating.');
      }
    },
    [savedMovie, currentRating, patchRating, invalidate]
  );

  const handleToggleWatched = useCallback(async () => {
    if (!savedMovie) return;
    const next = !currentWatched;
    setOptimisticWatched(next);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await patchWatched({ id: savedMovie.id, data: { isWatched: next } });
      await invalidate();
    } catch {
      setOptimisticWatched(undefined);
      Alert.alert('Error', 'Could not update watched status.');
    }
  }, [savedMovie, currentWatched, patchWatched, invalidate]);

  const handleAddToWatchlist = useCallback(async () => {
    try {
      await addMovie({
        data: {
          tmdbId,
          title: details?.title ?? title,
          releaseYear: details?.releaseYear ?? releaseYear,
          posterUrl: details?.posterUrl ?? posterUrl,
          overview: displayOverview,
        },
      });
      await invalidate();
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Added!', `"${title}" has been added to your Watchlist.`);
    } catch {
      Alert.alert('Error', 'Could not add this film to your Watchlist.');
    }
  }, [addMovie, tmdbId, title, releaseYear, posterUrl, details, displayOverview, invalidate]);

  const handleClose = useCallback(() => {
    setOptimisticRating(undefined);
    setOptimisticWatched(undefined);
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {/* Close button */}
        <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
          <Ionicons name="close" size={22} color="#111827" />
        </TouchableOpacity>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        >
          {/* Poster */}
          <View style={styles.posterContainer}>
            <Image
              source={{ uri: posterUrl }}
              style={styles.poster}
              contentFit="cover"
              transition={300}
              placeholder={require('@/assets/images/icon.png')}
            />
            <View style={styles.posterOverlay}>
              <Text style={styles.posterTitle} numberOfLines={2}>{title}</Text>
              <Text style={styles.posterYear}>{releaseYear}</Text>
            </View>
          </View>

          {/* Content */}
          <View style={styles.content}>

            {/* Genre tags */}
            {displayGenres.length > 0 && (
              <View style={styles.tagRow}>
                {displayGenres.map((g) => <GenreTag key={g} label={g} />)}
              </View>
            )}

            {/* Director + Language */}
            {isLoading && (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color="#0066FF" />
                <Text style={styles.loadingText}>Loading details…</Text>
              </View>
            )}

            {displayDirector ? (
              <View style={styles.metaRow}>
                <Ionicons name="film-outline" size={15} color="#6B7280" style={styles.metaIcon} />
                <Text style={styles.metaLabel}>Director</Text>
                <Text style={styles.metaValue}>{displayDirector}</Text>
              </View>
            ) : null}

            {displayLanguage ? (
              <View style={styles.metaRow}>
                <Ionicons name="language-outline" size={15} color="#6B7280" style={styles.metaIcon} />
                <Text style={styles.metaLabel}>Language</Text>
                <Text style={styles.metaValue}>{displayLanguage}</Text>
              </View>
            ) : null}

            {/* Lead Actors */}
            {displayCast.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Lead Actors</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8 }}
                >
                  {displayCast.slice(0, 8).map((name) => (
                    <View key={name} style={styles.actorPill}>
                      <Text style={styles.actorName}>{name}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Where to Watch */}
            {displayProviders.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Where to Watch</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 4 }}
                >
                  {displayProviders.map((p) => (
                    <ProviderPill
                      key={p.provider_id}
                      provider={p}
                      movieTitle={details?.title ?? title}
                    />
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Synopsis */}
            {displayOverview ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Synopsis</Text>
                <Text style={styles.synopsisText}>{displayOverview}</Text>
              </View>
            ) : null}

            {/* Divider */}
            <View style={styles.divider} />

            {/* Actions (only for saved movies) */}
            {savedMovie ? (
              <>
                {/* Star rating */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Your Rating</Text>
                  <StarRating value={currentRating} onChange={handleRating} />
                  {isRatingPending && (
                    <Text style={styles.savingText}>Saving…</Text>
                  )}
                </View>

                {/* Mark as Watched / Move to Watchlist */}
                <TouchableOpacity
                  style={[
                    styles.actionButton,
                    currentWatched
                      ? styles.actionButtonSecondary
                      : styles.actionButtonPrimary,
                  ]}
                  onPress={handleToggleWatched}
                  disabled={isWatchingPending}
                  activeOpacity={0.85}
                >
                  {isWatchingPending ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <>
                      <Ionicons
                        name={currentWatched ? 'bookmark-outline' : 'checkmark-circle-outline'}
                        size={20}
                        color="#FFFFFF"
                        style={{ marginRight: 8 }}
                      />
                      <Text style={styles.actionButtonText}>
                        {currentWatched ? 'Move to Watchlist' : 'Mark as Watched'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              /* Add to Watchlist (for home screen movies) */
              <TouchableOpacity
                style={[styles.actionButton, styles.actionButtonPrimary]}
                onPress={handleAddToWatchlist}
                disabled={isAddingPending}
                activeOpacity={0.85}
              >
                {isAddingPending ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Ionicons
                      name="bookmark-outline"
                      size={20}
                      color="#FFFFFF"
                      style={{ marginRight: 8 }}
                    />
                    <Text style={styles.actionButtonText}>Add to Watchlist</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 16,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  posterContainer: { width: W, height: POSTER_HEIGHT, position: 'relative' },
  poster: { width: '100%', height: '100%' },
  posterOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  posterTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    lineHeight: 30,
  },
  posterYear: {
    color: '#FF8C00',
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    marginTop: 4,
  },
  content: { paddingHorizontal: 20, paddingTop: 20 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  loadingText: { marginLeft: 8, fontSize: 13, color: '#6B7280', fontFamily: 'Inter_400Regular' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  metaIcon: { marginRight: 8 },
  metaLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#6B7280',
    width: 72,
  },
  metaValue: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#111827', flex: 1 },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#111827',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  actorPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  actorName: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#374151' },
  synopsisText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#374151',
    lineHeight: 22,
  },
  divider: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 20 },
  savingText: { fontSize: 12, color: '#9CA3AF', marginTop: 6, fontFamily: 'Inter_400Regular' },
  actionButton: {
    height: 52,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  actionButtonPrimary: { backgroundColor: '#0066FF' },
  actionButtonSecondary: { backgroundColor: '#FF8C00' },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
});
