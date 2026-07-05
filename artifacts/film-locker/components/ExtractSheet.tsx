import React, { useCallback, useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  Animated,
  Platform,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAddMovie,
  getListMoviesQueryKey,
  type MovieCandidate,
} from '@workspace/api-client-react';

interface ExtractSheetProps {
  visible: boolean;
  candidates: MovieCandidate[];
  lockerTmdbIds: Set<number>;
  onClose: () => void;
}

export function ExtractSheet({ visible, candidates, lockerTmdbIds, onClose }: ExtractSheetProps) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { mutateAsync: addMovie } = useAddMovie();
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());
  const slideAnim = useRef(new Animated.Value(0)).current;
  const [everShown, setEverShown] = useState(false);
  const { height: SCREEN_HEIGHT } = Dimensions.get('window');

  useEffect(() => {
    if (visible) {
      setEverShown(true);
      setAddedIds(new Set());
      Animated.spring(slideAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  const handleAdd = useCallback(
    async (candidate: MovieCandidate) => {
      if (addedIds.has(candidate.tmdbId) || loadingIds.has(candidate.tmdbId)) return;

      setLoadingIds((prev) => new Set(prev).add(candidate.tmdbId));
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      try {
        await addMovie({
          data: {
            tmdbId: candidate.tmdbId,
            title: candidate.title,
            releaseYear: candidate.releaseYear,
            posterUrl: candidate.posterUrl,
            overview: candidate.overview,
          },
        });
        setAddedIds((prev) => new Set(prev).add(candidate.tmdbId));
        await queryClient.invalidateQueries({ queryKey: getListMoviesQueryKey() });
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } catch {
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      } finally {
        setLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(candidate.tmdbId);
          return next;
        });
      }
    },
    [addedIds, loadingIds, addMovie, queryClient]
  );

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_HEIGHT, 0],
  });

  const renderCandidate = useCallback(
    ({ item }: { item: MovieCandidate }) => {
      const isAdded = addedIds.has(item.tmdbId) || lockerTmdbIds.has(item.tmdbId);
      const isLoading = loadingIds.has(item.tmdbId);

      return (
        <View style={[styles.candidateRow, { borderBottomColor: colors.border }]}>
          <Image
            source={{ uri: item.posterUrl }}
            style={[styles.candidatePoster, { borderRadius: 6 }]}
            contentFit="cover"
            placeholder={require('@/assets/images/icon.png')}
          />
          <View style={styles.candidateInfo}>
            <Text style={[styles.candidateTitle, { color: colors.foreground }]} numberOfLines={2}>
              {item.title}
            </Text>
            {item.releaseYear ? (
              <Text style={[styles.candidateYear, { color: colors.primary }]}>
                {item.releaseYear}
              </Text>
            ) : null}
            {item.overview ? (
              <Text style={[styles.candidateOverview, { color: colors.mutedForeground }]} numberOfLines={2}>
                {item.overview}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity
            style={[
              styles.addButton,
              {
                backgroundColor: isAdded ? colors.secondary : colors.primary,
                borderRadius: 20,
                opacity: isAdded ? 0.6 : 1,
              },
            ]}
            onPress={() => handleAdd(item)}
            disabled={isAdded || isLoading}
            activeOpacity={0.75}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.addButtonText, { color: isAdded ? colors.mutedForeground : colors.primaryForeground }]}>
                {isAdded ? '✓' : '+'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      );
    },
    [addedIds, loadingIds, colors, handleAdd]
  );

  if (!visible && !everShown) return null;

  return (
    <Modal transparent visible={visible} onRequestClose={onClose} animationType="slide">
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              transform: [{ translateY }],
              paddingBottom: Platform.OS === 'ios' ? 34 : 16,
            },
          ]}
        >
          <TouchableOpacity activeOpacity={1} style={{ flex: 1 }}>
            {/* Handle */}
            <View style={styles.handleContainer}>
              <View style={[styles.handle, { backgroundColor: colors.border }]} />
            </View>

            {/* Header */}
            <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
              <View>
                <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                  Films Found
                </Text>
                <Text style={[styles.sheetSubtitle, { color: colors.mutedForeground }]}>
                  {candidates.length} match{candidates.length !== 1 ? 'es' : ''} · tap + to add
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <Text style={[styles.closeText, { color: colors.mutedForeground }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {candidates.length === 0 ? (
              <View style={styles.noResults}>
                <Text style={[styles.noResultsText, { color: colors.mutedForeground }]}>
                  No movies detected in the caption.{'\n'}Try a caption with movie titles in quotes.
                </Text>
              </View>
            ) : (
              <FlatList
                data={candidates}
                keyExtractor={(item) => String(item.tmdbId)}
                renderItem={renderCandidate}
                showsVerticalScrollIndicator={false}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 8 }}
              />
            )}
          </TouchableOpacity>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

const { height: SCREEN_H } = Dimensions.get('window');

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: SCREEN_H * 0.75,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  sheetTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.3,
  },
  sheetSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  candidatePoster: {
    width: 54,
    height: 81,
    flexShrink: 0,
  },
  candidateInfo: {
    flex: 1,
  },
  candidateTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 19,
  },
  candidateYear: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 3,
  },
  candidateOverview: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 4,
    lineHeight: 15,
  },
  addButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  addButtonText: {
    fontSize: 20,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 22,
  },
  noResults: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  noResultsText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
  },
});
