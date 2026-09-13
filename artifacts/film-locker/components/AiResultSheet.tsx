import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { useColors } from '@/hooks/useColors';
import type { GeminiMovieMatch, Movie } from '@workspace/api-client-react';

interface AiResultSheetProps {
  visible: boolean;
  matches: GeminiMovieMatch[];
  saved: Movie[];
  onClose: () => void;
}

const CONFIDENCE_THRESHOLD = 0.45;
const { height: SCREEN_H } = Dimensions.get('window');

function ConfidencePill({ score }: { score: number }) {
  const colors = useColors();
  const pct = Math.round(score * 100);
  const bg =
    pct >= 80 ? '#16A34A' :
    pct >= 55 ? '#CA8A04' :
    '#DC2626';
  return (
    <View style={[styles.pill, { backgroundColor: bg + '22', borderColor: bg }]}>
      <Text style={[styles.pillText, { color: bg }]}>{pct}%</Text>
    </View>
  );
}

export function AiResultSheet({ visible, matches, saved, onClose }: AiResultSheetProps) {
  const colors = useColors();
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  }, [visible, slideAnim]);

  // Correlate by TMDB id (populated by backend after lookup) — not fragile title-string matching
  const savedTmdbIds = new Set(saved.map((m) => m.tmdbId));

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_H, 0],
  });

  const renderMatch = ({ item }: { item: GeminiMovieMatch }) => {
    // Use tmdb_id (resolved by backend) for accurate correlation — avoids title-string mismatch
    const resolvedTmdbId = item.tmdb_id ?? null;
    const wasSaved = resolvedTmdbId !== null && savedTmdbIds.has(resolvedTmdbId);
    const savedMovie = resolvedTmdbId !== null
      ? saved.find((m) => m.tmdbId === resolvedTmdbId)
      : undefined;
    const belowThreshold = item.confidence_score < CONFIDENCE_THRESHOLD;

    return (
      <View
        style={[
          styles.matchRow,
          { borderBottomColor: colors.border, opacity: belowThreshold ? 0.45 : 1 },
        ]}
      >
        {savedMovie?.posterUrl ? (
          <Image
            source={{ uri: savedMovie.posterUrl }}
            style={[styles.thumb, { borderRadius: 6 }]}
            contentFit="cover"
            placeholder={require('@/assets/images/icon.png')}
          />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder, { backgroundColor: colors.secondary, borderRadius: 6 }]}>
            <Text style={{ fontSize: 18 }}>🎬</Text>
          </View>
        )}

        <View style={styles.matchInfo}>
          <Text style={[styles.matchTitle, { color: colors.foreground }]} numberOfLines={1}>
            {item.movie_title}
          </Text>
          {item.release_year ? (
            <Text style={[styles.matchYear, { color: colors.primary }]}>
              {item.release_year}
            </Text>
          ) : null}
          <Text style={[styles.geminiLabel, { color: colors.mutedForeground }]}>
            Gemini confidence
          </Text>
        </View>

        <View style={styles.matchRight}>
          <ConfidencePill score={item.confidence_score} />
          {belowThreshold ? (
            <Text style={[styles.skipLabel, { color: colors.mutedForeground }]}>skipped</Text>
          ) : savedMovie ? (
            <Text style={[styles.savedLabel, { color: '#16A34A' }]}>✓ saved</Text>
          ) : (
            <Text style={[styles.skipLabel, { color: colors.mutedForeground }]}>not found</Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <Modal transparent visible={visible} onRequestClose={onClose} animationType="none">
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
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.headerTitle, { color: colors.foreground }]}>
                  Gemini Extraction
                </Text>
                <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
                  {saved.length} film{saved.length !== 1 ? 's' : ''} added to your locker
                  {matches.length > 0 ? ` · ${matches.length} detected` : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Text style={[styles.closeText, { color: colors.mutedForeground }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Gemini model badge */}
            <View style={[styles.modelBadgeRow, { borderBottomColor: colors.border }]}>
              <View style={[styles.modelBadge, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.modelBadgeText, { color: colors.primary }]}>
                  ✦ gemini-3.6-flash · structured JSON schema
                </Text>
              </View>
            </View>

            {matches.length === 0 ? (
              <View style={styles.empty}>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  Gemini found no film references in this text.{'\n'}
                  Try pasting a caption that mentions movie titles.
                </Text>
              </View>
            ) : (
              <FlatList
                data={matches}
                keyExtractor={(item, index) => `${item.movie_title}-${index}`}
                renderItem={renderMatch}
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

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: SCREEN_H * 0.78,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  handleContainer: { alignItems: 'center', paddingTop: 12, paddingBottom: 8 },
  handle: { width: 38, height: 4, borderRadius: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.3,
  },
  headerSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 16 },
  modelBadgeRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modelBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  modelBadgeText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.4,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  thumb: { width: 46, height: 69, flexShrink: 0 },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchInfo: { flex: 1 },
  matchTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 19,
  },
  matchYear: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  geminiLabel: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    marginTop: 4,
    letterSpacing: 0.3,
  },
  matchRight: {
    alignItems: 'flex-end',
    gap: 6,
    flexShrink: 0,
  },
  pill: {
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pillText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  savedLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  skipLabel: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
  },
});
