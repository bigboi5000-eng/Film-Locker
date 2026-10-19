import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Pressable,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';
const { width: SCREEN_W } = Dimensions.get('window');
const DROPDOWN_W = SCREEN_W - 32;

export interface FilterState {
  genre?: string;
  director?: string;
  actor?: string;
  language?: string;
  streaming?: string;
  /** One of LENGTH_BUCKETS' labels — a band, not an exact runtime. */
  length?: string;
  /** One of TMDB_BANDS' labels — a floor, not an exact score. */
  tmdbRating?: string;
  /** One of MY_BANDS' labels, or UNRATED. */
  myRating?: string;
}

/** Minimal shape that both Movie and TmdbMovieCard satisfy after adding genres. */
export interface FilterableMovie {
  genres?: string[];
  director?: string;
  cast?: string[];
  language?: string;
  watchProviders?: Array<{ provider_name: string }>;
  /** Minutes; null/undefined when TMDB has no runtime or enrichment is pending. */
  runtime?: number | null;
  /** TMDB's own average out of 10; null until the film has been enriched. */
  tmdbRating?: number | null;
  /** The owner's own score out of 5, in halves; null when unrated. */
  rating?: number | null;
}

/**
 * Length is banded rather than listed, because every other filter picks from
 * values that repeat across films — a director or a genre — whereas runtimes
 * are near-unique. A dropdown of "127 min", "128 min", "131 min" would be
 * useless; what people actually want to ask is "have I got time for this
 * tonight?"
 *
 * Bounds are inclusive at both ends and must not overlap.
 */
export const LENGTH_BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: 'Under 90 min', min: 1, max: 89 },
  { label: '90 min – 2 hr', min: 90, max: 120 },
  { label: '2 – 2½ hr', min: 121, max: 150 },
  { label: 'Over 2½ hr', min: 151, max: Infinity },
];

/**
 * Rating bands are floors, not buckets: "7+" rather than "7 to 8".
 *
 * Nobody looks through their own library for films rated exactly four —
 * they are looking for the good ones, and where the line falls is the only
 * thing they are really choosing. Bands that did not overlap would make
 * every answer a narrow slice and most of them empty.
 */
export const TMDB_BANDS: Array<{ label: string; min: number }> = [
  { label: '9+', min: 9 },
  { label: '8+', min: 8 },
  { label: '7+', min: 7 },
  { label: '6+', min: 6 },
  { label: '5+', min: 5 },
];

/** Half-star floors, matching the ten positions a film can be given. */
export const MY_BANDS: Array<{ label: string; min: number }> = [
  { label: '5', min: 5 },
  { label: '4½+', min: 4.5 },
  { label: '4+', min: 4 },
  { label: '3½+', min: 3.5 },
  { label: '3+', min: 3 },
  { label: '2½+', min: 2.5 },
  { label: '2+', min: 2 },
  { label: '1½+', min: 1.5 },
  { label: '1+', min: 1 },
];

/**
 * Its own answer rather than a band at the bottom of the list: "what have I
 * watched and never scored" is a different question from "what did I score
 * badly", and a floor of zero cannot ask it.
 */
export const UNRATED = 'Not rated';

function matchesBand(
  score: number | null | undefined,
  bands: Array<{ label: string; min: number }>,
  label: string
): boolean {
  // Unknown is excluded rather than treated as nought, for the same reason
  // an unknown runtime is not evidence of a short film: a film nobody has
  // scored is not a film that scored badly.
  if (typeof score !== 'number') return false;
  const band = bands.find((b) => b.label === label);
  return band ? score >= band.min : false;
}

function matchesLengthBucket(runtime: number | null | undefined, label: string): boolean {
  // Unknown length is excluded rather than swept into the shortest band —
  // a film we have no runtime for is not evidence of a short film.
  if (typeof runtime !== 'number' || runtime <= 0) return false;
  const bucket = LENGTH_BUCKETS.find((b) => b.label === label);
  if (!bucket) return false;
  return runtime >= bucket.min && runtime <= bucket.max;
}

interface FilterBarProps {
  movies: FilterableMovie[];
  filters: FilterState;
  onChange: (filters: FilterState) => void;
}

type FilterKey = keyof FilterState;

const FILTER_LABELS: Record<FilterKey, string> = {
  genre: 'Genre',
  director: 'Director',
  actor: 'Actor',
  language: 'Language',
  streaming: 'Streaming',
  length: 'Length',
  tmdbRating: 'TMDB rating',
  myRating: 'Your rating',
};

/**
 * The simple chips. Rating is not among them because it is two questions
 * behind one chip — TMDB's score and your own — and a chip that carried
 * only one of them would leave the other unreachable.
 */
const FILTER_KEYS: FilterKey[] = ['genre', 'length', 'director', 'actor', 'language', 'streaming'];

/** The two-section chip's own key, which is not a FilterState field. */
const RATING_PICKER = 'rating' as const;
type PickerKey = FilterKey | typeof RATING_PICKER;

/** Apply all active filters to a movie list. */
export function applyFilters<T extends FilterableMovie>(movies: T[], filters: FilterState): T[] {
  return movies.filter((m) => {
    const genres = m.genres ?? [];
    const cast = m.cast ?? [];
    const providers = m.watchProviders ?? [];
    if (filters.genre && !genres.includes(filters.genre)) return false;
    if (filters.director && m.director !== filters.director) return false;
    if (filters.actor && !cast.includes(filters.actor)) return false;
    if (filters.language && m.language !== filters.language) return false;
    if (filters.streaming && !providers.some((p) => p.provider_name === filters.streaming))
      return false;
    if (filters.length && !matchesLengthBucket(m.runtime, filters.length)) return false;
    if (filters.tmdbRating && !matchesBand(m.tmdbRating, TMDB_BANDS, filters.tmdbRating))
      return false;
    if (filters.myRating === UNRATED) {
      if (typeof m.rating === 'number') return false;
    } else if (filters.myRating && !matchesBand(m.rating, MY_BANDS, filters.myRating)) {
      return false;
    }
    return true;
  });
}

/** Extract unique, sorted option values for a given filter key. */
function getOptions(movies: FilterableMovie[], key: FilterKey): string[] {
  const values = new Set<string>();
  for (const m of movies) {
    const genres = m.genres ?? [];
    const cast = m.cast ?? [];
    const providers = m.watchProviders ?? [];
    if (key === 'genre') genres.forEach((g) => g && values.add(g));
    else if (key === 'director') m.director && values.add(m.director);
    else if (key === 'actor') cast.forEach((a) => a && values.add(a));
    else if (key === 'language') m.language && values.add(m.language);
    else if (key === 'streaming')
      providers.forEach((p) => p.provider_name && values.add(p.provider_name));
    else if (key === 'length') {
      const bucket = LENGTH_BUCKETS.find((b) => matchesLengthBucket(m.runtime, b.label));
      if (bucket) values.add(bucket.label);
    } else if (key === 'tmdbRating') {
      // Every band this film clears, not just the highest: the bands
      // overlap, so offering only the top one would hide "7+" from a list
      // whose best film scores 9.
      TMDB_BANDS.forEach((b) => matchesBand(m.tmdbRating, TMDB_BANDS, b.label) && values.add(b.label));
    } else if (key === 'myRating') {
      if (typeof m.rating === 'number') {
        MY_BANDS.forEach((b) => matchesBand(m.rating, MY_BANDS, b.label) && values.add(b.label));
      } else {
        values.add(UNRATED);
      }
    }
  }
  // Bands have a natural order that alphabetical sorting would destroy
  // ("2 – 2½ hr" before "Under 90 min"), so keep them in the declared order.
  if (key === 'length') {
    return LENGTH_BUCKETS.filter((b) => values.has(b.label)).map((b) => b.label);
  }
  if (key === 'tmdbRating') {
    return TMDB_BANDS.filter((b) => values.has(b.label)).map((b) => b.label);
  }
  if (key === 'myRating') {
    const bands = MY_BANDS.filter((b) => values.has(b.label)).map((b) => b.label);
    return values.has(UNRATED) ? [...bands, UNRATED] : bands;
  }
  return Array.from(values).sort();
}

export function FilterBar({ movies, filters, onChange }: FilterBarProps) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const wrapperRef = useRef<View>(null);
  const [pickerKey, setPickerKey] = useState<PickerKey | null>(null);
  const [dropdownTop, setDropdownTop] = useState(200);

  const activeCount = Object.values(filters).filter(Boolean).length;

  const options = useMemo(
    () => (pickerKey && pickerKey !== RATING_PICKER ? getOptions(movies, pickerKey) : []),
    [movies, pickerKey]
  );

  // The two halves of the rating chip, each offering only the bands some
  // film in the list actually clears.
  const tmdbOptions = useMemo(() => getOptions(movies, 'tmdbRating'), [movies]);
  const myOptions = useMemo(() => getOptions(movies, 'myRating'), [movies]);

  const ratingActive = Boolean(filters.tmdbRating || filters.myRating);
  const ratingLabel = [
    filters.tmdbRating ? `TMDB ${filters.tmdbRating}` : null,
    filters.myRating ? (filters.myRating === UNRATED ? UNRATED : `You ${filters.myRating}`) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const openPicker = useCallback((key: PickerKey) => {
    // Measure the chip row's bottom edge, then open the dropdown.
    // setPickerKey is only called inside the callback so the modal never
    // renders at a stale position.
    if (wrapperRef.current) {
      wrapperRef.current.measureInWindow((_x, y, _w, h) => {
        setDropdownTop(y + h + 4);
        setPickerKey(key);
      });
    } else {
      // Fallback for environments where the ref isn't ready
      setDropdownTop(200);
      setPickerKey(key);
    }
  }, []);

  /** Toggle one band inside the rating dropdown, leaving the other alone. */
  const selectRating = useCallback(
    (key: 'tmdbRating' | 'myRating', value: string) => {
      const next = { ...filters };
      if (next[key] === value) delete next[key];
      else next[key] = value;
      onChange(next);
      // Deliberately left open: the two sections are one question with two
      // halves, and closing on the first would make the second a second trip.
    },
    [filters, onChange]
  );

  const clearRating = useCallback(() => {
    const next = { ...filters };
    delete next.tmdbRating;
    delete next.myRating;
    onChange(next);
  }, [filters, onChange]);

  const selectOption = useCallback(
    (value: string) => {
      if (!pickerKey || pickerKey === RATING_PICKER) return;
      // Toggle: selecting the same value clears it
      const next = filters[pickerKey] === value
        ? (() => { const f = { ...filters }; delete f[pickerKey]; return f; })()
        : { ...filters, [pickerKey]: value };
      onChange(next);
      setPickerKey(null);
    },
    [pickerKey, filters, onChange]
  );

  const clearFilter = useCallback(
    (key: FilterKey) => {
      const next = { ...filters };
      delete next[key];
      onChange(next);
    },
    [filters, onChange]
  );

  const clearAll = useCallback(() => onChange({}), [onChange]);
  const closeDropdown = useCallback(() => setPickerKey(null), []);

  return (
    <>
      <View ref={wrapperRef} collapsable={false}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
          style={styles.scroll}
        >
          {/* All chip */}
          <TouchableOpacity
            onPress={clearAll}
            style={[styles.chip, activeCount === 0 && styles.chipActive]}
            activeOpacity={0.75}
          >
            <Text style={[styles.chipText, activeCount === 0 && styles.chipTextActive]}>
              All
            </Text>
          </TouchableOpacity>

          {FILTER_KEYS.map((key) => {
            const value = filters[key];
            const isActive = Boolean(value);
            return (
              <TouchableOpacity
                key={key}
                onPress={() => (isActive ? clearFilter(key) : openPicker(key))}
                style={[styles.chip, isActive && styles.chipActive]}
                activeOpacity={0.75}
              >
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                  {isActive ? `${FILTER_LABELS[key]}: ${value}` : FILTER_LABELS[key]}
                </Text>
                <Ionicons
                  name={isActive ? 'close' : 'chevron-down'}
                  size={12}
                  color={isActive ? colors.background : colors.textMuted}
                  style={{ marginLeft: 4 }}
                />
              </TouchableOpacity>
            );
          })}

          {/* Rating — one chip, two questions. */}
          <TouchableOpacity
            onPress={() => (ratingActive ? clearRating() : openPicker(RATING_PICKER))}
            style={[styles.chip, ratingActive && styles.chipActive]}
            activeOpacity={0.75}
          >
            <Text
              style={[styles.chipText, ratingActive && styles.chipTextActive]}
              numberOfLines={1}
            >
              {ratingActive ? ratingLabel : 'Rating'}
            </Text>
            <Ionicons
              name={ratingActive ? 'close' : 'chevron-down'}
              size={12}
              color={ratingActive ? colors.background : colors.textMuted}
              style={{ marginLeft: 4 }}
            />
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Inline dropdown — transparent modal anchored to the chip row's bottom */}
      <Modal
        visible={pickerKey !== null}
        transparent
        animationType="fade"
        onRequestClose={closeDropdown}
      >
        <Pressable style={styles.backdrop} onPress={closeDropdown}>
          {/* Stop propagation so tapping inside the card doesn't close it */}
          <Pressable
            style={[styles.dropdownCard, { top: dropdownTop, width: DROPDOWN_W }]}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Card header */}
            <View style={styles.dropdownHeader}>
              <Text style={styles.dropdownTitle}>
                {pickerKey === RATING_PICKER ? 'Rating' : pickerKey ? FILTER_LABELS[pickerKey] : ''}
              </Text>
              <TouchableOpacity onPress={closeDropdown} hitSlop={8}>
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {pickerKey === RATING_PICKER ? (
              <ScrollView
                style={styles.optionScroll}
                bounces={false}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
              >
                <Text style={styles.sectionHeading}>TMDB rating</Text>
                {tmdbOptions.length === 0 ? (
                  <Text style={styles.sectionEmpty}>
                    No scores yet — they arrive as films are enriched.
                  </Text>
                ) : (
                  tmdbOptions.map((band) => {
                    const isSelected = filters.tmdbRating === band;
                    return (
                      <TouchableOpacity
                        key={`tmdb-${band}`}
                        onPress={() => selectRating('tmdbRating', band)}
                        style={[styles.optionRow, isSelected && styles.optionRowActive]}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.optionText, isSelected && styles.optionTextActive]}>
                          {band}
                        </Text>
                        {isSelected ? (
                          <Ionicons name="checkmark" size={16} color={colors.primary} />
                        ) : null}
                      </TouchableOpacity>
                    );
                  })
                )}

                <Text style={[styles.sectionHeading, styles.sectionHeadingSecond]}>
                  Your rating
                </Text>
                {myOptions.length === 0 ? (
                  <Text style={styles.sectionEmpty}>Nothing rated yet.</Text>
                ) : (
                  myOptions.map((band) => {
                    const isSelected = filters.myRating === band;
                    return (
                      <TouchableOpacity
                        key={`mine-${band}`}
                        onPress={() => selectRating('myRating', band)}
                        style={[styles.optionRow, isSelected && styles.optionRowActive]}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.optionText, isSelected && styles.optionTextActive]}>
                          {band}
                        </Text>
                        {isSelected ? (
                          <Ionicons name="checkmark" size={16} color={colors.primary} />
                        ) : null}
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            ) : options.length === 0 ? (
              <View style={styles.emptyDropdown}>
                <Text style={styles.emptyDropdownText}>No data yet</Text>
              </View>
            ) : (
              <ScrollView
                style={styles.optionScroll}
                bounces={false}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
              >
                {options.map((item) => {
                  const isSelected = pickerKey ? filters[pickerKey] === item : false;
                  return (
                    <TouchableOpacity
                      key={item}
                      onPress={() => selectOption(item)}
                      style={[styles.optionRow, isSelected && styles.optionRowActive]}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[styles.optionText, isSelected && styles.optionTextActive]}
                        numberOfLines={1}
                      >
                        {item}
                      </Text>
                      {isSelected && (
                        <Ionicons name="checkmark" size={16} color={colors.primary} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexDirection: 'row' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
  },
  chipActive: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: c.textStrong },
  chipTextActive: { color: c.onColor },
  // Dropdown
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  dropdownCard: {
    position: 'absolute',
    left: 16,
    backgroundColor: c.background,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
    maxHeight: 280,
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  dropdownTitle: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: c.text,
  },
  optionScroll: { maxHeight: 220 },
  sectionHeading: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: c.textFaint,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
  sectionHeadingSecond: {
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: c.borderSubtle,
    paddingTop: 14,
  },
  sectionEmpty: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: c.textFaint,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.surfaceAlt,
  },
  optionRowActive: { backgroundColor: c.primarySoft },
  optionText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: c.text,
    flex: 1,
    marginRight: 8,
  },
  optionTextActive: { fontFamily: 'Inter_600SemiBold', color: c.primary },
  emptyDropdown: { padding: 20, alignItems: 'center' },
  emptyDropdownText: { fontSize: 13, color: c.textFaint, fontFamily: 'Inter_400Regular' },
});
