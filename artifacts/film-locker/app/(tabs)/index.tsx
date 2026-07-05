import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  Platform,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListMovies,
  useDeleteMovie,
  useAiExtract,
  getListMoviesQueryKey,
  type Movie,
  type GeminiMovieMatch,
} from '@workspace/api-client-react';
import { MovieCard, MovieCardSkeleton } from '@/components/MovieCard';
import { AiResultSheet } from '@/components/AiResultSheet';
import { EmptyState } from '@/components/EmptyState';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HORIZONTAL_PADDING = 16;
const COLUMN_GAP = 10;

export default function LockerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [caption, setCaption] = useState('');
  const [resultVisible, setResultVisible] = useState(false);
  const [lastMatches, setLastMatches] = useState<GeminiMovieMatch[]>([]);
  const [lastSaved, setLastSaved] = useState<Movie[]>([]);
  const inputRef = useRef<TextInput>(null);

  const { data: moviesData, isLoading, isRefetching, refetch } = useListMovies();
  const { mutateAsync: aiExtract, isPending: isExtracting } = useAiExtract();
  const { mutateAsync: deleteMovie } = useDeleteMovie();

  const movies = moviesData?.movies ?? [];

  const handleExtract = useCallback(async () => {
    const trimmed = caption.trim();
    if (!trimmed) return;
    inputRef.current?.blur();

    try {
      const result = await aiExtract({ data: { text: trimmed } });
      setLastMatches(result.matches ?? []);
      setLastSaved(result.saved ?? []);
      setResultVisible(true);
      await queryClient.invalidateQueries({ queryKey: getListMoviesQueryKey() });
      if (Platform.OS !== 'web' && (result.saved?.length ?? 0) > 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      Alert.alert('Error', 'Could not extract movies. Please try again.');
    }
  }, [caption, aiExtract, queryClient]);

  const handleDelete = useCallback(
    (id: number) => {
      Alert.alert(
        'Remove from Locker',
        'Remove this film from your locker?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              if (Platform.OS !== 'web') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }
              try {
                await deleteMovie({ id });
                await queryClient.invalidateQueries({ queryKey: getListMoviesQueryKey() });
              } catch {
                Alert.alert('Error', 'Could not remove the film.');
              }
            },
          },
        ]
      );
    },
    [deleteMovie, queryClient]
  );

  const renderMovie = useCallback(
    ({ item }: { item: Movie }) => (
      <MovieCard
        id={item.id}
        title={item.title}
        releaseYear={item.releaseYear}
        posterUrl={item.posterUrl}
        onLongPress={handleDelete}
      />
    ),
    [handleDelete]
  );

  const isInputEmpty = caption.trim().length === 0;

  const ListHeader = (
    <View style={styles.listHeader}>
      {/* App Header */}
      <View
        style={[
          styles.appHeader,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0),
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={styles.appTitleRow}>
          <Text style={[styles.appTitle, { color: colors.foreground }]}>FILM LOCKER</Text>
          {movies.length > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>
                {movies.length}
              </Text>
            </View>
          )}
        </View>
        <Text style={[styles.appSubtitle, { color: colors.mutedForeground }]}>
          Your personal cinema vault
        </Text>
      </View>

      {/* Caption Input */}
      <View style={[styles.captionSection, { backgroundColor: colors.muted }]}>
        {/* AI badge */}
        <View style={styles.labelRow}>
          <Text style={[styles.captionLabel, { color: colors.mutedForeground }]}>
            PASTE A CAPTION OR TEXT
          </Text>
          <View style={[styles.aiBadge, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.aiBadgeText, { color: colors.primary }]}>
              ✦ Gemini 2.5 Flash
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.inputWrapper,
            { backgroundColor: colors.input, borderColor: colors.border, borderRadius: colors.radius },
          ]}
        >
          <TextInput
            ref={inputRef}
            value={caption}
            onChangeText={setCaption}
            placeholder={'e.g. just watched \u201cDune\u201d and \u201cOppenheimer\u201d back to back...'}
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={3}
            style={[
              styles.textInput,
              { color: colors.foreground, fontFamily: 'Inter_400Regular' },
            ]}
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity
          style={[
            styles.extractButton,
            {
              backgroundColor:
                isInputEmpty || isExtracting ? colors.secondary : colors.primary,
              borderRadius: colors.radius,
              opacity: isInputEmpty ? 0.5 : 1,
            },
          ]}
          onPress={handleExtract}
          disabled={isInputEmpty || isExtracting}
          activeOpacity={0.8}
        >
          {isExtracting ? (
            <View style={styles.extractButtonInner}>
              <ActivityIndicator color={colors.primaryForeground} size="small" />
              <Text style={[styles.extractButtonText, { color: colors.primaryForeground }]}>
                Extracting with Gemini…
              </Text>
            </View>
          ) : (
            <Text
              style={[
                styles.extractButtonText,
                {
                  color: isInputEmpty ? colors.mutedForeground : colors.primaryForeground,
                },
              ]}
            >
              Extract & Save to Locker
            </Text>
          )}
        </TouchableOpacity>

        <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
          Gemini reads the text, extracts films with confidence scores, queries TMDB for posters, and saves directly to your locker.
        </Text>
      </View>

      {/* Section label */}
      {movies.length > 0 && (
        <View style={styles.sectionLabelRow}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            YOUR LOCKER
          </Text>
          <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>
            Hold to remove
          </Text>
        </View>
      )}
    </View>
  );

  const renderSkeletons = () => (
    <View style={styles.gridContainer}>
      {[...Array(6)].map((_, i) => (
        <MovieCardSkeleton key={i} />
      ))}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {isLoading ? (
        <>
          {ListHeader}
          {renderSkeletons()}
        </>
      ) : (
        <FlatList<Movie>
          data={movies}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderMovie}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={[
            styles.contentContainer,
            { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 16) },
          ]}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={<EmptyState />}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}

      <AiResultSheet
        visible={resultVisible}
        matches={lastMatches}
        saved={lastSaved}
        onClose={() => setResultVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  contentContainer: { paddingHorizontal: HORIZONTAL_PADDING },
  listHeader: { marginBottom: 12 },
  appHeader: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  appTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  appTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 3,
  },
  appSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
    letterSpacing: 0.5,
  },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  badgeText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  captionSection: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 16,
    paddingBottom: 14,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  captionLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.5,
  },
  aiBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  aiBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.4,
  },
  inputWrapper: {
    borderWidth: 1,
    marginBottom: 10,
  },
  textInput: {
    fontSize: 14,
    lineHeight: 21,
    padding: 12,
    minHeight: 80,
  },
  extractButton: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  extractButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  extractButtonText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.5,
  },
  hintText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    lineHeight: 16,
    textAlign: 'center',
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 16,
    paddingBottom: 10,
  },
  sectionLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.5,
  },
  sectionHint: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  columnWrapper: { gap: COLUMN_GAP, marginBottom: COLUMN_GAP },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: COLUMN_GAP,
  },
});
