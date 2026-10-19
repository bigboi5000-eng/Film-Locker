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
import { StarRating, formatStars } from '@/components/StarRating';
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
  /**
   * Floor for TMDB's score, in STARS (0.5–5 in halves), not in TMDB's own
   * 0–10. Both sliders read in the same units so one gesture means the same
   * thing in both halves of the dropdown; the doubling happens at the
   * comparison. Absent, or nought, means no floor.
   */
  tmdbMin?: number;
  /** Floor for the owner's own score, 0.5–5 in halves. */
  myMin?: number;
  /**
   * "What have I watched and never scored" — a different question from "what
   * did I score badly", and no floor can ask it, since a floor of nought
   * matches everything.
   */
  unratedOnly?: boolean;
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
 * TMDB scores out of ten, we score out of five. The sliders both read in
 * stars, so the TMDB floor is doubled on its way to the comparison: three
 * stars asks for 6.0 and up.
 */
export const TMDB_PER_STAR = 2;

/** The TMDB score a star threshold is asking for, as TMDB writes it. */
export function tmdbScoreFor(stars: number): number {
  return stars * TMDB_PER_STAR;
}

/**
 * A floor, applied to a score that may not exist.
 *
 * Unknown is excluded rather than treated as nought, for the same reason an
 * unknown runtime is not evidence of a short film: a film nobody has scored
 * is not a film that scored badly.
 */
function clearsFloor(score: number | null | undefined, floor: number): boolean {
  if (!floor) return true;
  if (typeof score !== 'number') return false;
  return score >= floor;
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

/** The filters that pick a value from the films in front of them. */
type ChipKey = 'genre' | 'director' | 'actor' | 'language' | 'streaming' | 'length';

const FILTER_LABELS: Record<ChipKey, string> = {
  genre: 'Genre',
  director: 'Director',
  actor: 'Actor',
  language: 'Language',
  streaming: 'Streaming',
  length: 'Length',
};

const FILTER_KEYS: ChipKey[] = ['genre', 'length', 'director', 'actor', 'language', 'streaming'];

/**
 * Rating's own key, which is not a FilterState field: it is one chip over
 * three controls — TMDB's floor, your floor, and unrated — and a chip that
 * carried only one of them would leave the others unreachable.
 */
const RATING_PICKER = 'rating' as const;
type PickerKey = ChipKey | typeof RATING_PICKER;

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
    if (!clearsFloor(m.tmdbRating, tmdbScoreFor(filters.tmdbMin ?? 0))) return false;
    if (filters.unratedOnly) {
      if (typeof m.rating === 'number') return false;
    } else if (!clearsFloor(m.rating, filters.myMin ?? 0)) {
      return false;
    }
    return true;
  });
}

/** Extract unique, sorted option values for a given filter key. */
function getOptions(movies: FilterableMovie[], key: ChipKey): string[] {
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
    }
  }
  // Bands have a natural order that alphabetical sorting would destroy
  // ("2 – 2½ hr" before "Under 90 min"), so keep them in the declared order.
  if (key === 'length') {
    return LENGTH_BUCKETS.filter((b) => values.has(b.label)).map((b) => b.label);
  }
  return Array.from(values).sort();
}

/** "3½+", or "Any" at nought — the slider's resting position. */
function floorLabel(stars: number | undefined): string {
  return stars ? `${formatStars(stars)}+` : 'Any';
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

  const ratingActive = Boolean(filters.tmdbMin || filters.myMin || filters.unratedOnly);
  const ratingLabel = [
    filters.tmdbMin ? `TMDB ${floorLabel(filters.tmdbMin)}` : null,
    filters.unratedOnly ? 'Unrated' : filters.myMin ? `You ${floorLabel(filters.myMin)}` : null,
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

  /**
   * Move one of the two floors. Nought removes the key outright rather than
   * storing a nought, so "any" and "unset" are the same state and the active
   * count does not have to know the difference.
   */
  const setFloor = useCallback(
    (key: 'tmdbMin' | 'myMin', stars: number) => {
      const next = { ...filters };
      if (stars > 0) next[key] = stars;
      else delete next[key];
      // A floor on your own score and "unrated only" are contradictory
      // questions, so asking one answers the other.
      if (key === 'myMin' && stars > 0) delete next.unratedOnly;
      onChange(next);
      // Deliberately left open: three controls are one question, and closing
      // on the first would make the rest a second trip.
    },
    [filters, onChange]
  );

  const toggleUnrated = useCallback(() => {
    const next = { ...filters };
    if (next.unratedOnly) delete next.unratedOnly;
    else {
      next.unratedOnly = true;
      delete next.myMin;
    }
    onChange(next);
  }, [filters, onChange]);

  const clearRating = useCallback(() => {
    const next = { ...filters };
    delete next.tmdbMin;
    delete next.myMin;
    delete next.unratedOnly;
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
    (key: ChipKey) => {
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

          {/* Rating — one chip, two sliders. */}
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
              // Two sliders and a toggle, all visible at once — no scrolling,
              // which is the whole point of replacing the two lists of bands.
              <View style={styles.ratingBody}>
                <View style={styles.sliderBlock}>
                  <View style={styles.sliderHeading}>
                    <Text style={styles.sectionHeading}>TMDB rating</Text>
                    <Text style={styles.floorValue}>
                      {filters.tmdbMin
                        ? `${floorLabel(filters.tmdbMin)}  ·  ${tmdbScoreFor(
                            filters.tmdbMin
                          ).toFixed(1)}/10`
                        : 'Any'}
                    </Text>
                  </View>
                  <StarRating
                    value={filters.tmdbMin ?? 0}
                    onChange={(stars) => setFloor('tmdbMin', stars)}
                    size={30}
                    gap={8}
                    allowZero
                  />
                  <Text style={styles.sliderHint}>
                    Tap for whole stars, slide for halves.
                  </Text>
                </View>

                <View style={[styles.sliderBlock, styles.sliderBlockSecond]}>
                  <View style={styles.sliderHeading}>
                    <Text style={styles.sectionHeading}>Your rating</Text>
                    <Text style={styles.floorValue}>
                      {filters.unratedOnly ? '—' : floorLabel(filters.myMin)}
                    </Text>
                  </View>
                  <StarRating
                    value={filters.unratedOnly ? 0 : filters.myMin ?? 0}
                    onChange={(stars) => setFloor('myMin', stars)}
                    size={30}
                    gap={8}
                    allowZero
                  />
                  <TouchableOpacity
                    onPress={toggleUnrated}
                    style={styles.unratedRow}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={filters.unratedOnly ? 'checkbox' : 'square-outline'}
                      size={18}
                      color={filters.unratedOnly ? colors.primary : colors.textFaint}
                    />
                    <Text
                      style={[
                        styles.unratedText,
                        filters.unratedOnly && styles.unratedTextActive,
                      ]}
                    >
                      Not rated yet
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
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
    maxHeight: 340,
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
  ratingBody: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 14 },
  sliderBlock: { paddingTop: 8 },
  sliderBlockSecond: {
    marginTop: 12,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: c.borderSubtle,
  },
  sliderHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionHeading: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: c.textFaint,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  floorValue: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: c.text,
  },
  sliderHint: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: c.textFaint,
    marginTop: 8,
  },
  unratedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  unratedText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: c.textMuted,
  },
  unratedTextActive: { fontFamily: 'Inter_600SemiBold', color: c.primary },
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
