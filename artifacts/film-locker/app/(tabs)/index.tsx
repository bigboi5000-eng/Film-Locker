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
  useParseCaption,
  getListMoviesQueryKey,
  type Movie,
  type MovieCandidate,
} from '@workspace/api-client-react';
import { MovieCard, MovieCardSkeleton } from '@/components/MovieCard';
import { ExtractSheet } from '@/components/ExtractSheet';
import { EmptyState } from '@/components/EmptyState';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HORIZONTAL_PADDING = 16;
const COLUMN_GAP = 10;

export default function LockerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [caption, setCaption] = useState('');
  const [sheetVisible, setSheetVisible] = useState(false);
  const [candidates, setCandidates] = useState<MovieCandidate[]>([]);
  const inputRef = useRef<TextInput>(null);

  const {
    data: moviesData,
    isLoading,
    isRefetching,
    refetch,
  } = useListMovies();

  const { mutateAsync: parseCaption, isPending: isParsing } = useParseCaption();
  const { mutateAsync: deleteMovie } = useDeleteMovie();

  const movies = moviesData?.movies ?? [];

  const handleExtract = useCallback(async () => {
    const trimmed = caption.trim();
    if (!trimmed) return;

    inputRef.current?.blur();

    try {
      const result = await parseCaption({ data: { caption: trimmed } });
      setCandidates(result.candidates ?? []);
      setSheetVisible(true);
    } catch {
      Alert.alert('Error', 'Could not parse the caption. Please try again.');
    }
  }, [caption, parseCaption]);

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
        <Text style={[styles.captionLabel, { color: colors.mutedForeground }]}>
          PASTE A CAPTION
        </Text>
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
              {
                color: colors.foreground,
                fontFamily: 'Inter_400Regular',
              },
            ]}
            textAlignVertical="top"
          />
        </View>
        <TouchableOpacity
          style={[
            styles.extractButton,
            {
              backgroundColor: isInputEmpty || isParsing ? colors.secondary : colors.primary,
              borderRadius: colors.radius,
              opacity: isInputEmpty ? 0.5 : 1,
            },
          ]}
          onPress={handleExtract}
          disabled={isInputEmpty || isParsing}
          activeOpacity={0.8}
        >
          {isParsing ? (
            <ActivityIndicator color={colors.primaryForeground} size="small" />
          ) : (
            <Text
              style={[
                styles.extractButtonText,
                { color: isInputEmpty ? colors.mutedForeground : colors.primaryForeground },
              ]}
            >
              Extract Movies
            </Text>
          )}
        </TouchableOpacity>
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
          scrollEnabled={true}
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

      <ExtractSheet
        visible={sheetVisible}
        candidates={candidates}
        lockerTmdbIds={new Set(movies.map((m) => m.tmdbId))}
        onClose={() => setSheetVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  listHeader: {
    marginBottom: 12,
  },
  appHeader: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 0,
  },
  appTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
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
  badgeText: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  captionSection: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 16,
    paddingBottom: 16,
  },
  captionLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.5,
    marginBottom: 8,
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
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  extractButtonText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.5,
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
  sectionHint: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  columnWrapper: {
    gap: COLUMN_GAP,
    marginBottom: COLUMN_GAP,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: COLUMN_GAP,
  },
});
