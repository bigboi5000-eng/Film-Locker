/**
 * ShareFilmSheet
 *
 * Bottom sheet shown after the app processes a shared URL in dry-run mode.
 * Displays each identified film with poster/title, lets the user tap
 * "Add to Watchlist", and offers a "Return to [app]" action once done.
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Animated,
  Dimensions,
  Platform,
  BackHandler,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  useAddMovie,
  getListMoviesQueryKey,
  type GeminiMovieMatch,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useToast } from '@/components/ToastProvider';

interface ShareFilmSheetProps {
  visible: boolean;
  /** Matches returned by the dry-run processLink call */
  matches: GeminiMovieMatch[];
  onClose: () => void;
}

const CONFIDENCE_THRESHOLD = 0.45;
const { height: SCREEN_H } = Dimensions.get('window');

/** Single film card inside the sheet */
function FilmCard({
  match,
  onAdded,
}: {
  match: GeminiMovieMatch;
  onAdded: () => void;
}) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { mutateAsync: addMovie, isPending } = useAddMovie();
  const [added, setAdded] = useState(false);

  const handleAdd = useCallback(async () => {
    if (!match.tmdb_id || added || isPending) return;
    try {
      await addMovie({
        data: {
          tmdbId: match.tmdb_id,
          title: match.title ?? match.movie_title,
          releaseYear: match.release_year,
          posterUrl: match.poster_url ?? '',
          overview: match.overview ?? '',
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListMoviesQueryKey() });
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setAdded(true);
      onAdded();
    } catch {
      showToast({ title: 'Could not add film', subtitle: 'Check your connection and try again.', variant: 'error' });
    }
  }, [match, added, isPending, addMovie, queryClient, showToast, onAdded]);

  const displayTitle = match.title ?? match.movie_title;
  const posterUri = match.poster_url;

  return (
    <View style={[cardStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Poster */}
      {posterUri ? (
        <Image
          source={{ uri: posterUri }}
          style={cardStyles.poster}
          contentFit="cover"
          transition={200}
          placeholder={require('@/assets/images/icon.png')}
        />
      ) : (
        <View style={[cardStyles.poster, cardStyles.posterFallback, { backgroundColor: colors.secondary }]}>
          <Text style={{ fontSize: 28 }}>🎬</Text>
        </View>
      )}

      {/* Info */}
      <View style={cardStyles.info}>
        <Text style={[cardStyles.title, { color: colors.foreground }]} numberOfLines={2}>
          {displayTitle}
        </Text>
        {match.release_year ? (
          <Text style={[cardStyles.year, { color: colors.primary }]}>
            {match.release_year}
          </Text>
        ) : null}
        {match.overview ? (
          <Text style={[cardStyles.overview, { color: colors.mutedForeground }]} numberOfLines={3}>
            {match.overview}
          </Text>
        ) : null}

        {/* Add button */}
        {added ? (
          <View style={cardStyles.addedRow}>
            <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
            <Text style={cardStyles.addedText}>Added to Watchlist</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[cardStyles.addBtn, { backgroundColor: colors.primary }]}
            onPress={handleAdd}
            disabled={isPending || !match.tmdb_id}
            activeOpacity={0.8}
          >
            {isPending ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Ionicons name="bookmark-outline" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={cardStyles.addBtnText}>Add to Watchlist</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  poster: { width: 70, height: 105, borderRadius: 8, flexShrink: 0 },
  posterFallback: { alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1 },
  title: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    lineHeight: 20,
    marginBottom: 3,
  },
  year: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 6,
  },
  overview: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 17,
    marginBottom: 10,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  addBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  addedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  addedText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#16A34A',
  },
});

// ── Main sheet ────────────────────────────────────────────────────────────────

export function ShareFilmSheet({ visible, matches, onClose }: ShareFilmSheetProps) {
  const colors = useColors();
  const slideAnim = useRef(new Animated.Value(0)).current;
  const [addedCount, setAddedCount] = useState(0);

  // Candidates are matches that passed confidence threshold and have a TMDB id
  const candidates = matches.filter(
    (m) => m.confidence_score >= CONFIDENCE_THRESHOLD && m.tmdb_id != null
  );

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      tension: 60,
      friction: 11,
    }).start();
  }, [visible, slideAnim]);

  // Reset counter when sheet opens for a new share
  useEffect(() => {
    if (visible) setAddedCount(0);
  }, [visible]);

  const handleAdded = useCallback(() => {
    setAddedCount((n) => n + 1);
  }, []);

  const handleReturn = useCallback(() => {
    onClose();
    // Give the close animation a moment, then exit Film Locker so Android
    // returns the user to whichever app they shared from.
    setTimeout(() => {
      BackHandler.exitApp();
    }, 200);
  }, [onClose]);

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_H, 0],
  });

  const allAdded = candidates.length > 0 && addedCount >= candidates.length;

  return (
    <Modal transparent visible={visible} onRequestClose={onClose} animationType="none">
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              transform: [{ translateY }],
              paddingBottom: Platform.OS === 'ios' ? 34 : 20,
            },
          ]}
        >
          {/* Prevent inner taps from closing the sheet */}
          <TouchableOpacity activeOpacity={1} style={{ flex: 1 }}>

            {/* Handle bar */}
            <View style={styles.handleContainer}>
              <View style={[styles.handle, { backgroundColor: colors.border }]} />
            </View>

            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.headerTitle, { color: colors.foreground }]}>
                  {candidates.length > 0 ? '🎬 Film Found' : 'No Film Found'}
                </Text>
                <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
                  {candidates.length > 0
                    ? `${candidates.length} film${candidates.length !== 1 ? 's' : ''} identified from this link`
                    : 'Gemini could not identify a film in this post'}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
                <Ionicons name="close" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {/* Content */}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {candidates.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="film-outline" size={44} color={colors.mutedForeground} />
                  <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                    No film identified
                  </Text>
                  <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                    Try sharing a post with a visible film title or caption.
                  </Text>
                </View>
              ) : (
                candidates.map((match, i) => (
                  <FilmCard key={`${match.tmdb_id ?? match.movie_title}-${i}`} match={match} onAdded={handleAdded} />
                ))
              )}
            </ScrollView>

            {/* Footer — Return button */}
            <View style={[styles.footer, { borderTopColor: colors.border }]}>
              {allAdded ? (
                <TouchableOpacity
                  style={[styles.returnBtn, { backgroundColor: '#16A34A' }]}
                  onPress={handleReturn}
                  activeOpacity={0.85}
                >
                  <Ionicons name="arrow-back" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={styles.returnBtnText}>Return to previous app</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.returnBtn, { backgroundColor: colors.muted }]}
                  onPress={handleReturn}
                  activeOpacity={0.85}
                >
                  <Ionicons name="arrow-back" size={18} color={colors.mutedForeground} style={{ marginRight: 8 }} />
                  <Text style={[styles.returnBtnText, { color: colors.mutedForeground }]}>
                    Return without adding
                  </Text>
                </TouchableOpacity>
              )}
            </View>

          </TouchableOpacity>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: SCREEN_H * 0.85,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
  },
  handleContainer: { alignItems: 'center', paddingTop: 12, paddingBottom: 8 },
  handle: { width: 38, height: 4, borderRadius: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.2,
  },
  headerSub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: 3,
    lineHeight: 18,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 4,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 19,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  returnBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 12,
  },
  returnBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFFFFF',
  },
});
