/**
 * FilmSearchTools.tsx
 *
 * The search bar that identifies films, and the machinery behind it.
 *
 * Extracted from the Watchlist screen so Home can have the same tools. It is
 * split into a hook and a presentational bar rather than one component,
 * because the two screens lay their results out differently: the Watchlist
 * gives recommendations the whole list area, while Home shows them under its
 * browse rows. A component that rendered its own results would have to be
 * told where to put them, which is how a shared component turns back into two
 * components with a flag.
 *
 * So the hook owns the awkward parts — an animated panel, two image pickers
 * with different permission copy, three mutations and the states between them
 * — and hands back both what the bar needs to draw and what the screen needs
 * to arrange itself around it.
 *
 * Copying the bar into Home instead would have been quicker and wrong: the
 * subtleties here (naming the right permission when one is refused, letting
 * the closing animation finish before unmounting, measuring a pixel target
 * because flex cannot be animated smoothly) are exactly the things that would
 * be fixed in one copy and not the other.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Alert,
  Platform,
  StyleSheet,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useProcessSocialLink,
  useExtractFromImage,
  useRecommendMovies,
  type GeminiMovieMatch,
  type Movie,
} from '@workspace/api-client-react';
import { useToast } from '@/components/ToastProvider';
import { pickImageFromLibrary, takeFilmPhoto, type PickResult } from '@/lib/pickFilmImage';

const HORIZONTAL_PADDING = 16;

// ── Input classification ─────────────────────────────────────────────────────
// One bar handles three inputs: a pasted URL, a plain title (live TMDB
// search), or a natural-language recommendation request. No scheme required —
// people paste "instagram.com/reel/…" without "https://" all the time.
const URL_LIKE_RE = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i;

// Google's share sheet (and similar) prepends the page title before the link,
// e.g. "Schindler's List https://share.google/5PhWqNwJU80K34PTK" — that fails
// URL_LIKE_RE (it is not ENTIRELY a URL) but still needs the link path rather
// than a literal TMDB search for the whole string. The backend already splits
// the title from the URL; this only has to recognise and forward it.
const EMBEDDED_URL_RE = /https?:\/\/\S+/i;

export function looksLikeUrl(text: string): boolean {
  const trimmed = text.trim();
  return URL_LIKE_RE.test(trimmed) || EMBEDDED_URL_RE.test(trimmed);
}

/**
 * A multi-word request or a question reads as a recommendation ask rather
 * than a title fragment — skip the live TMDB dropdown so it does not flash
 * "no results" mid-sentence.
 */
export function looksLikeSentence(text: string): boolean {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return wordCount > 5 || text.includes('?');
}

// ── AI recommendation row ────────────────────────────────────────────────────

export interface AiResultRowProps {
  match: GeminiMovieMatch;
  isSaved: boolean;
  savedMovie?: Movie;
  onPress: (match: GeminiMovieMatch, savedMovie?: Movie) => void;
}

/** Same shape as a search result, plus the one-sentence hook Gemini writes. */
export function AiResultRow({ match, isSaved, savedMovie, onPress }: AiResultRowProps) {
  return (
    <TouchableOpacity
      style={styles.resultRow}
      onPress={() => onPress(match, savedMovie)}
      activeOpacity={0.75}
    >
      <Image
        source={{ uri: match.poster_url ?? undefined }}
        style={styles.resultPoster}
        contentFit="cover"
        transition={200}
        placeholder={require('@/assets/images/icon.png')}
      />
      <View style={styles.resultInfo}>
        <Text style={styles.resultTitle} numberOfLines={2}>
          {match.title ?? match.movie_title}
        </Text>
        {match.release_year ? <Text style={styles.resultYear}>{match.release_year}</Text> : null}
        {match.synopsis ? (
          <Text style={styles.resultSynopsis} numberOfLines={2}>
            {match.synopsis}
          </Text>
        ) : null}
      </View>
      {isSaved && (
        <View style={styles.savedBadge}>
          <Ionicons name="bookmark" size={14} color="#FFFFFF" />
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── The hook ─────────────────────────────────────────────────────────────────

export interface FilmSearchToolsOptions {
  /**
   * Gate for the actions that need an account. Returns false and does its own
   * prompting when there is none. Searching films needs no account;
   * identifying them from a link or a photo, and asking for recommendations,
   * all exist to fill a locker that a guest does not have.
   */
  requireAccount: (action: string) => boolean;
  /** Films identified from a pasted link or an image, for a confirmation sheet. */
  onMatches: (matches: GeminiMovieMatch[], listTitle: string | null) => void;
}

export type FilmSearchTools = ReturnType<typeof useFilmSearchTools>;

export function useFilmSearchTools({ requireAccount, onMatches }: FilmSearchToolsOptions) {
  const { showToast } = useToast();

  // aiVisible controls mounting; aiOpen is the target state driving the
  // animation's direction. Kept apart so the closing animation finishes
  // playing before the bar unmounts.
  const [aiVisible, setAiVisible] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiQuery, setAiQuery] = useState('');
  const [aiResults, setAiResults] = useState<GeminiMovieMatch[]>([]);
  const [rowWidth, setRowWidth] = useState(0);
  const aiAnim = useRef(new Animated.Value(0)).current;
  const aiInputRef = useRef<TextInput>(null);

  // Row minus the fixed 44px toggle and the 8px gap — the pixel width the AI
  // bar animates open to. Flex cannot be animated smoothly here, since it is
  // the row's only flex-grow child and has nothing to share space with.
  const aiTargetWidth = Math.max(rowWidth - 44 - 8, 0);

  const { mutateAsync: processLink, isPending: isProcessingLink } = useProcessSocialLink();
  const { mutateAsync: extractFromImage, isPending: isExtractingImage } = useExtractFromImage();
  const { mutateAsync: recommend, isPending: isRecommending } = useRecommendMovies();

  /**
   * Send a pasted link through the identification pipeline.
   *
   * Resolves true when a link was actually handled, so the caller can clear
   * the field — the bar does, since leaving the URL sitting there after the
   * results have opened reads as though nothing happened.
   */
  const submitLink = useCallback(
    async (raw: string): Promise<boolean> => {
      const trimmed = raw.trim();
      if (!trimmed || !looksLikeUrl(trimmed) || isProcessingLink) return false;
      if (!requireAccount('identify films from a link')) return false;
      try {
        const result = await processLink({ data: { url: trimmed, dryRun: true } });
        const matches = result.matches ?? [];
        if (matches.length > 0 && Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        // Zero matches still opens the sheet — its "No film identified" state
        // offers a manual search, so the flow is not a dead end.
        onMatches(matches, result.listTitle ?? null);
        return true;
      } catch {
        Alert.alert('Error', 'Could not process the link. Please try again.');
        return false;
      }
    },
    [isProcessingLink, processLink, requireAccount, onMatches]
  );

  /**
   * Identify films from a photo or screenshot — a poster shot in the wild, or
   * a post whose titles are printed in the image rather than written in its
   * caption, which the link pipeline cannot read.
   */
  const runImageExtraction = useCallback(
    async (result: PickResult) => {
      if (!result.ok) {
        const isCamera = result.source === 'camera';
        if (result.reason === 'permission-denied') {
          // Naming the right permission matters: this used to say "photo
          // access" whichever picker had been refused, sending someone who
          // had declined the camera to look for a setting already on. The
          // Settings shortcut is the only thing that can fix it — iOS never
          // asks a second time.
          Alert.alert(
            isCamera ? 'Camera access needed' : 'Photo access needed',
            isCamera
              ? 'Film Locker needs camera access to photograph a poster or listing.'
              : 'Film Locker needs photo access to read films from an image you pick.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open Settings', onPress: () => { void Linking.openSettings(); } },
            ]
          );
        } else if (result.reason === 'unreadable') {
          showToast({ title: 'Could not read that image', variant: 'error' });
        } else if (result.reason === 'failed') {
          showToast({
            title: isCamera ? 'Could not open the camera' : 'Could not open your photos',
            subtitle: 'Please try again.',
            variant: 'error',
          });
        }
        // 'cancelled' is the user changing their mind — say nothing.
        return;
      }

      try {
        const response = await extractFromImage({
          data: {
            imageBase64: result.image.base64,
            mimeType: result.image.mimeType,
            dryRun: true,
          },
        });

        const matches = response.matches ?? [];
        if (matches.length > 0 && Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        // Zero matches still opens the sheet — its "No film identified" state
        // offers a manual search, the same as the link flow.
        onMatches(matches, response.listTitle ?? null);
      } catch {
        Alert.alert('Error', 'Could not read films from that image. Please try again.');
      }
    },
    [extractFromImage, showToast, onMatches]
  );

  const pickImage = useCallback(() => {
    if (!requireAccount('identify films from a photo')) return;
    Alert.alert(
      'Identify films from an image',
      'Photograph a poster or listing, or pick a screenshot of a post.',
      [
        { text: 'Take a photo', onPress: () => { void takeFilmPhoto().then(runImageExtraction); } },
        { text: 'Choose from library', onPress: () => { void pickImageFromLibrary().then(runImageExtraction); } },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }, [runImageExtraction, requireAccount]);

  /**
   * One request in, a short list out. Deliberately not a chat: the results
   * render as a plain tappable list, the same as a TMDB search.
   */
  const submitAi = useCallback(async () => {
    if (!requireAccount('ask for recommendations')) return;
    const trimmed = aiQuery.trim();
    if (!trimmed || isRecommending) return;
    setAiResults([]);
    try {
      const result = await recommend({ data: { query: trimmed, dryRun: true } });
      if (result.offTopic) {
        showToast({
          title: 'Film & TV only',
          subtitle: 'Try something like "a 90 minute horror film similar to Texas Chainsaw".',
          variant: 'error',
        });
        return;
      }
      const matches = (result.matches ?? []).filter((m) => m.tmdb_id != null).slice(0, 6);
      if (matches.length === 0) {
        showToast({
          title: 'No Recommendations Found',
          subtitle: 'Try rephrasing your request.',
          variant: 'error',
        });
        return;
      }
      setAiResults(matches);
    } catch {
      Alert.alert('Error', 'Could not get a recommendation. Please try again.');
    }
  }, [aiQuery, isRecommending, recommend, showToast, requireAccount]);

  /**
   * Grows the AI bar open from the left and shrinks it closed again. The
   * mounted flag is cleared only once the closing animation has finished, or
   * the bar vanishes mid-slide.
   */
  const toggleAi = useCallback(() => {
    if (!aiOpen) {
      setAiVisible(true);
      setAiOpen(true);
      Animated.timing(aiAnim, { toValue: 1, duration: 260, useNativeDriver: false }).start(() => {
        setTimeout(() => aiInputRef.current?.focus(), 30);
      });
    } else {
      setAiOpen(false);
      Animated.timing(aiAnim, { toValue: 0, duration: 220, useNativeDriver: false }).start(() => {
        setAiVisible(false);
        setAiQuery('');
        setAiResults([]);
      });
    }
  }, [aiOpen, aiAnim]);

  return {
    // For the screen to arrange itself around.
    aiOpen,
    aiResults,
    isRecommending,
    isProcessingLink,
    isExtractingImage,
    // For the bar.
    aiVisible,
    aiQuery,
    setAiQuery,
    aiAnim,
    aiInputRef,
    aiTargetWidth,
    setRowWidth,
    submitLink,
    submitAi,
    pickImage,
    toggleAi,
  };
}

// ── The bar ──────────────────────────────────────────────────────────────────

export interface FilmSearchBarProps {
  tools: FilmSearchTools;
  query: string;
  onQueryChange: (q: string) => void;
  /** The screen owns this: Home browses, the Watchlist also pastes links. */
  placeholder?: string;
}

export function FilmSearchBar({
  tools,
  query,
  onQueryChange,
  placeholder = 'Search a film or paste a social link…',
}: FilmSearchBarProps) {
  const {
    aiVisible,
    aiOpen,
    aiQuery,
    setAiQuery,
    aiAnim,
    aiInputRef,
    aiTargetWidth,
    setRowWidth,
    isRecommending,
    isProcessingLink,
    isExtractingImage,
    submitLink,
    submitAi,
    pickImage,
    toggleAi,
  } = tools;

  /** Clear the field once a link has actually been taken up. */
  const sendLink = useCallback(() => {
    void submitLink(query).then((handled) => {
      if (handled) onQueryChange('');
    });
  }, [submitLink, query, onQueryChange]);

  return (
    <View style={styles.searchRow} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
      {aiVisible ? (
        <Animated.View
          style={[
            styles.aiContainer,
            { width: aiAnim.interpolate({ inputRange: [0, 1], outputRange: [0, aiTargetWidth] }) },
          ]}
        >
          <Ionicons name="sparkles" size={15} color="#0066FF" style={styles.searchIcon} />
          <TextInput
            ref={aiInputRef}
            value={aiQuery}
            onChangeText={setAiQuery}
            placeholder="Ask for a recommendation…"
            placeholderTextColor="#9CA3AF"
            style={styles.searchInput}
            returnKeyType="go"
            onSubmitEditing={submitAi}
          />
          {isRecommending && <ActivityIndicator color="#0066FF" size="small" />}
        </Animated.View>
      ) : (
        <View style={styles.searchContainer}>
          <Ionicons name="search-outline" size={16} color="#9CA3AF" style={styles.searchIcon} />
          <TextInput
            value={query}
            onChangeText={onQueryChange}
            placeholder={placeholder}
            placeholderTextColor="#9CA3AF"
            style={styles.searchInput}
            returnKeyType="go"
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={sendLink}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => onQueryChange('')} hitSlop={8} style={{ marginRight: 6 }}>
              <Ionicons name="close-circle" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          )}
          {/* Identify films from a photo. Sits where a lens icon sits in a
              search bar, and only while the field is empty, so it never
              competes with the clear and submit controls. */}
          {query.length === 0 && (
            <TouchableOpacity onPress={pickImage} disabled={isExtractingImage} hitSlop={8}>
              {isExtractingImage ? (
                <ActivityIndicator color="#0066FF" size="small" />
              ) : (
                <Ionicons name="camera-outline" size={20} color="#0066FF" />
              )}
            </TouchableOpacity>
          )}
          {looksLikeUrl(query.trim()) && (
            <TouchableOpacity onPress={sendLink} disabled={isProcessingLink} hitSlop={8}>
              {isProcessingLink ? (
                <ActivityIndicator color="#0066FF" size="small" />
              ) : (
                <Ionicons name="arrow-forward-circle" size={24} color="#0066FF" />
              )}
            </TouchableOpacity>
          )}
        </View>
      )}
      <TouchableOpacity style={styles.aiToggleBtn} onPress={toggleAi} activeOpacity={0.8}>
        <Ionicons name={aiOpen ? 'close' : 'sparkles'} size={18} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: HORIZONTAL_PADDING,
    marginTop: HORIZONTAL_PADDING,
    marginBottom: 8,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  aiContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 12,
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#93C5FD',
    overflow: 'hidden',
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#111827',
    // react-native-web never resets the browser's default focus outline on
    // the underlying <input> — without this, typing draws a separate black
    // ring around the input, distinct from the pill border around it.
    borderWidth: 0,
    ...(Platform.OS === 'web' ? { outlineWidth: 0 } : null),
  },
  aiToggleBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  resultPoster: {
    width: 42,
    height: 63,
    borderRadius: 6,
    backgroundColor: '#F3F4F6',
    marginRight: 12,
  },
  resultInfo: { flex: 1 },
  resultTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#111827',
    lineHeight: 19,
  },
  resultYear: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#FF8C00',
    marginTop: 3,
  },
  resultSynopsis: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
    marginTop: 4,
    lineHeight: 16,
  },
  savedBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
});
