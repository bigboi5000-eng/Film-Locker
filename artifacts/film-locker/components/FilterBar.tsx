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
import { RangeSlider, formatRange, MAX_VALUE } from '@/components/RangeSlider';
import {
  SortSheet,
  describeSort,
  isDefaultSortFor,
  type SortState,
} from '@/components/SortSheet';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';
const { width: SCREEN_W } = Dimensions.get('window');
const DROPDOWN_W = SCREEN_W - 32;
/**
 * The sliders' width, derived rather than measured: the card is DROPDOWN_W
 * and the rating body insets it by 16 each side. Handing the control a
 * number it can trust is the whole reason it needs no onLayout.
 */
const SLIDER_W = DROPDOWN_W - 32;

export interface FilterState {
  genre?: string;
  director?: string;
  actor?: string;
  language?: string;
  streaming?: string;
  /**
   * The span of runtimes to keep, in MINUTES.
   *
   * Four fixed bands could only ask the questions somebody else had thought
   * of — "under 90", "over 2½ hours" — and not "between an hour and a half
   * and two", which is the one people actually have time for. Absent means
   * no bound on that side.
   */
  runtimeMin?: number;
  runtimeMax?: number;
  /**
   * The span of TMDB scores to keep, in STARS (0–5 in halves), not in
   * TMDB's own 0–10. Both sliders read in the same units so one gesture
   * means the same thing in either half of the dropdown; the doubling
   * happens at the comparison.
   *
   * A floor alone could only ask "at least this good", which cannot say
   * "the middling ones" or "the ones I disliked". Absent means no bound on
   * that side — 0 and 5 are the ends, and both ends open is no filter.
   */
  tmdbMin?: number;
  tmdbMax?: number;
  /** The span of the owner's own scores to keep, 0–5 in halves. */
  myMin?: number;
  myMax?: number;
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
 * The runtime slider's scale: nought to four hours, in ten-minute steps.
 *
 * Four hours because the top of the range has to mean "and up" — there are
 * films past it, and a slider that stopped at the longest film anybody owns
 * would move its own ends about as the locker changed. A film over the top
 * end counts as being at it, so "3 hours and up" catches the five-hour one
 * as well.
 *
 * Ten minutes because a finger cannot pick a single minute on a phone, and
 * nobody filtering by length wants one.
 */
export const RUNTIME_MAX = 240;
export const RUNTIME_STEPS = 24;

/** "1h 30m", "2h", "45m" — the way anybody says a running time. */
export function formatRuntime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** The span in words, or "Any" when both ends are home. */
export function formatRuntimeRange(min: number, max: number): string {
  const open = min <= 0;
  const full = max >= RUNTIME_MAX;
  if (open && full) return 'Any';
  if (open) return `up to ${formatRuntime(max)}`;
  if (full) return `${formatRuntime(min)}+`;
  return `${formatRuntime(min)} – ${formatRuntime(max)}`;
}

export const TMDB_PER_STAR = 2;

/** The TMDB score a star threshold is asking for, as TMDB writes it. */
export function tmdbScoreFor(stars: number): number {
  return stars * TMDB_PER_STAR;
}

/**
 * A span, applied to a score that may not exist.
 *
 * Unknown is excluded whenever either end has been moved, for the same
 * reason an unknown runtime is not evidence of a short film: a film nobody
 * has scored is not a film that scored badly, and it is not a film that
 * scored well either. "What have I not rated" is a different question, and
 * the checkbox under the second slider is where it is asked.
 */
function inSpan(
  score: number | null | undefined,
  min: number,
  max: number,
  scale: number
): boolean {
  const open = min <= 0 && max >= MAX_VALUE;
  if (open) return true;
  if (typeof score !== 'number') return false;
  return score >= min * scale && score <= max * scale;
}

/**
 * A runtime span, applied to a length that may not be known.
 *
 * Unknown is excluded whenever either end has moved, for the reason the old
 * band version gave: a film we have no runtime for is not evidence of a
 * short film. A film LONGER than the top of the scale counts as being at
 * the top, so the upper end genuinely means "and up".
 */
function inRuntimeSpan(runtime: number | null | undefined, min: number, max: number): boolean {
  const open = min <= 0 && max >= RUNTIME_MAX;
  if (open) return true;
  if (typeof runtime !== 'number' || runtime <= 0) return false;
  const clamped = Math.min(runtime, RUNTIME_MAX);
  return clamped >= min && clamped <= max;
}

interface FilterBarProps {
  movies: FilterableMovie[];
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  /**
   * Sorting, when the screen offers it. Omitted on screens that do not —
   * a playlist is in the order its owner put it in — and then only the
   * Filter button is drawn.
   */
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  /**
   * Whether this list is of watched films. Decides both which orders are
   * offered and which one counts as the resting default.
   */
  showWatchedSort?: boolean;
}

/** The filters that pick a value from the films in front of them. */
type ChipKey = 'genre' | 'director' | 'actor' | 'language' | 'streaming';

const FILTER_LABELS: Record<ChipKey, string> = {
  genre: 'Genre',
  director: 'Director',
  actor: 'Actor',
  language: 'Language',
  streaming: 'Streaming',
};

const FILTER_KEYS: ChipKey[] = ['genre', 'director', 'actor', 'language', 'streaming'];

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
    if (!inRuntimeSpan(m.runtime, filters.runtimeMin ?? 0, filters.runtimeMax ?? RUNTIME_MAX))
      return false;
    if (!inSpan(m.tmdbRating, filters.tmdbMin ?? 0, filters.tmdbMax ?? MAX_VALUE, TMDB_PER_STAR))
      return false;
    if (filters.unratedOnly) {
      if (typeof m.rating === 'number') return false;
    } else if (!inSpan(m.rating, filters.myMin ?? 0, filters.myMax ?? MAX_VALUE, 1)) {
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
  }
  return Array.from(values).sort();
}

/** Whether a span actually narrows anything. */
function spanActive(min: number | undefined, max: number | undefined): boolean {
  return (min ?? 0) > 0 || (max ?? MAX_VALUE) < MAX_VALUE;
}

export function FilterBar({
  movies,
  filters,
  onChange,
  sort,
  onSortChange,
  showWatchedSort,
}: FilterBarProps) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  /** Which category list is expanded. One at a time — see the comment below. */
  const [expanded, setExpanded] = useState<ChipKey | null>(null);

  const tmdbSpan = spanActive(filters.tmdbMin, filters.tmdbMax);
  const mySpan = spanActive(filters.myMin, filters.myMax);
  const ratingActive = tmdbSpan || mySpan || Boolean(filters.unratedOnly);

  /**
   * Counted rather than taken from truthiness. A span whose upper end sits
   * at nought stores a nought, which is falsy, so counting values would
   * report "no filters" while a filter was plainly narrowing the list.
   */
  const runtimeActive =
    (filters.runtimeMin ?? 0) > 0 || (filters.runtimeMax ?? RUNTIME_MAX) < RUNTIME_MAX;

  const activeCount =
    FILTER_KEYS.filter((k) => filters[k]).length +
    (ratingActive ? 1 : 0) +
    (runtimeActive ? 1 : 0);

  const setRuntime = useCallback(
    (min: number, max: number) => {
      const next = { ...filters };
      if (min > 0) next.runtimeMin = min; else delete next.runtimeMin;
      if (max < RUNTIME_MAX) next.runtimeMax = max; else delete next.runtimeMax;
      onChange(next);
    },
    [filters, onChange]
  );

  const setSpan = useCallback(
    (which: 'tmdb' | 'my', min: number, max: number) => {
      const next = { ...filters };
      const minKey = which === 'tmdb' ? 'tmdbMin' : 'myMin';
      const maxKey = which === 'tmdb' ? 'tmdbMax' : 'myMax';
      if (min > 0) next[minKey] = min; else delete next[minKey];
      if (max < MAX_VALUE) next[maxKey] = max; else delete next[maxKey];
      if (which === 'my' && spanActive(min, max)) delete next.unratedOnly;
      onChange(next);
    },
    [filters, onChange]
  );

  const toggleUnrated = useCallback(() => {
    const next = { ...filters };
    if (next.unratedOnly) delete next.unratedOnly;
    else {
      next.unratedOnly = true;
      delete next.myMin;
      delete next.myMax;
    }
    onChange(next);
  }, [filters, onChange]);

  /** Pick a value for one category, or clear it by picking it again. */
  const selectValue = useCallback(
    (key: ChipKey, value: string) => {
      const next = { ...filters };
      if (next[key] === value) delete next[key];
      else next[key] = value;
      onChange(next);
    },
    [filters, onChange]
  );

  const clearAll = useCallback(() => onChange({}), [onChange]);

  const matching = useMemo(() => applyFilters(movies, filters).length, [movies, filters]);

  return (
    <>
      <View style={styles.bar}>
        <TouchableOpacity
          style={[styles.button, activeCount > 0 && styles.buttonActive]}
          onPress={() => setFilterOpen(true)}
          activeOpacity={0.75}
        >
          <Ionicons
            name="options-outline"
            size={16}
            color={activeCount > 0 ? colors.onColor : colors.textStrong}
          />
          <Text style={[styles.buttonText, activeCount > 0 && styles.buttonTextActive]}>
            Filter
          </Text>
          {activeCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{activeCount}</Text>
            </View>
          ) : null}
        </TouchableOpacity>

        {sort && onSortChange ? (
          <TouchableOpacity
            style={[styles.button, !isDefaultSortFor(sort, Boolean(showWatchedSort)) && styles.buttonActive]}
            onPress={() => setSortOpen(true)}
            activeOpacity={0.75}
          >
            <Ionicons
              name="swap-vertical-outline"
              size={16}
              color={!isDefaultSortFor(sort, Boolean(showWatchedSort)) ? colors.onColor : colors.textStrong}
            />
            <Text
              style={[styles.buttonText, !isDefaultSortFor(sort, Boolean(showWatchedSort)) && styles.buttonTextActive]}
              numberOfLines={1}
            >
              {isDefaultSortFor(sort, Boolean(showWatchedSort)) ? 'Sort' : describeSort(sort)}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* ── Everything, in one sheet ─────────────────────────────────────
          Previously each filter was its own chip opening its own dropdown,
          so finding out what was available meant opening six of them in
          turn and closing each one to see the next. One sheet answers
          "what can I narrow this by" by being looked at. */}
      <Modal
        visible={filterOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setFilterOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Filters</Text>
                {/* Live, and up here as well as on the button: the whole
                    reason for one sheet is watching the number move as the
                    set is built, and the footer is below the fold on a
                    short phone once a category is open. */}
                <Text style={styles.sheetCount}>
                  {matching} of {movies.length} film{movies.length === 1 ? '' : 's'}
                </Text>
              </View>
              {activeCount > 0 ? (
                <TouchableOpacity onPress={clearAll} hitSlop={8}>
                  <Text style={styles.clearAll}>Clear all</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity onPress={() => setFilterOpen(false)} hitSlop={8} style={{ marginLeft: 14 }}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.sheetBody} bounces={false}>
              {/* Ratings first: they are the two people reach for most and
                  the only ones that need a control rather than a list. */}
              <View style={styles.block}>
                <View style={styles.blockHead}>
                  <Text style={styles.blockTitle}>TMDB rating</Text>
                  <Text style={styles.blockValue}>
                    {tmdbSpan
                      ? `${formatRange(filters.tmdbMin ?? 0, filters.tmdbMax ?? MAX_VALUE)}  ·  ${tmdbScoreFor(filters.tmdbMin ?? 0).toFixed(1)}–${tmdbScoreFor(filters.tmdbMax ?? MAX_VALUE).toFixed(1)}`
                      : 'Any'}
                  </Text>
                </View>
                <RangeSlider
                  min={filters.tmdbMin ?? 0}
                  max={filters.tmdbMax ?? MAX_VALUE}
                  onChange={(lo, hi) => setSpan('tmdb', lo, hi)}
                  width={SLIDER_W}
                />
              </View>

              <View style={[styles.block, styles.blockDivided]}>
                <View style={styles.blockHead}>
                  <Text style={styles.blockTitle}>Your rating</Text>
                  <Text style={styles.blockValue}>
                    {filters.unratedOnly
                      ? '—'
                      : formatRange(filters.myMin ?? 0, filters.myMax ?? MAX_VALUE)}
                  </Text>
                </View>
                <RangeSlider
                  min={filters.unratedOnly ? 0 : filters.myMin ?? 0}
                  max={filters.unratedOnly ? MAX_VALUE : filters.myMax ?? MAX_VALUE}
                  onChange={(lo, hi) => setSpan('my', lo, hi)}
                  width={SLIDER_W}
                />
                <TouchableOpacity onPress={toggleUnrated} style={styles.unratedRow} activeOpacity={0.7}>
                  <Ionicons
                    name={filters.unratedOnly ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={filters.unratedOnly ? colors.primary : colors.textFaint}
                  />
                  <Text style={[styles.unratedText, filters.unratedOnly && styles.unratedTextActive]}>
                    Not rated yet
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.block, styles.blockDivided]}>
                <View style={styles.blockHead}>
                  <Text style={styles.blockTitle}>Runtime</Text>
                  <Text style={styles.blockValue}>
                    {formatRuntimeRange(
                      filters.runtimeMin ?? 0,
                      filters.runtimeMax ?? RUNTIME_MAX
                    )}
                  </Text>
                </View>
                <RangeSlider
                  min={filters.runtimeMin ?? 0}
                  max={filters.runtimeMax ?? RUNTIME_MAX}
                  onChange={setRuntime}
                  width={SLIDER_W}
                  maxValue={RUNTIME_MAX}
                  steps={RUNTIME_STEPS}
                  tickEvery={60}
                />
              </View>

              {/* The categorical ones, as rows that open in place. One at a
                  time, because a thousand actors expanded under six other
                  open sections is a scroll nobody can navigate. */}
              {FILTER_KEYS.map((key) => {
                const options = getOptions(movies, key);
                const value = filters[key];
                const isOpen = expanded === key;
                return (
                  <View key={key} style={[styles.block, styles.blockDivided]}>
                    <TouchableOpacity
                      style={styles.blockHead}
                      onPress={() => setExpanded(isOpen ? null : key)}
                      activeOpacity={0.7}
                      disabled={options.length === 0}
                    >
                      <Text style={styles.blockTitle}>{FILTER_LABELS[key]}</Text>
                      <View style={styles.blockHeadRight}>
                        <Text
                          style={[styles.blockValue, !value && styles.blockValueEmpty]}
                          numberOfLines={1}
                        >
                          {value ?? (options.length === 0 ? 'None yet' : 'Any')}
                        </Text>
                        {options.length > 0 ? (
                          <Ionicons
                            name={isOpen ? 'chevron-up' : 'chevron-down'}
                            size={15}
                            color={colors.textFaint}
                          />
                        ) : null}
                      </View>
                    </TouchableOpacity>

                    {isOpen ? (
                      <View style={styles.optionWrap}>
                        {options.map((opt) => {
                          const picked = value === opt;
                          return (
                            <TouchableOpacity
                              key={opt}
                              onPress={() => selectValue(key, opt)}
                              style={[styles.optionChip, picked && styles.optionChipPicked]}
                              activeOpacity={0.75}
                            >
                              <Text
                                style={[styles.optionChipText, picked && styles.optionChipTextPicked]}
                                numberOfLines={1}
                              >
                                {opt}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.sheetFooter}>
              <TouchableOpacity
                style={styles.applyBtn}
                onPress={() => setFilterOpen(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.applyBtnText}>
                  {/* The count, because the whole point of seeing every
                      filter at once is knowing what they add up to. */}
                  Show {matching} film{matching === 1 ? '' : 's'}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {sort && onSortChange ? (
        <SortSheet
          visible={sortOpen}
          onClose={() => setSortOpen(false)}
          sort={sort}
          onChange={onSortChange}
          showWatchedOptions={showWatchedSort}
        />
      ) : null}
    </>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  bar: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  button: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 10,
    backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
  },
  buttonActive: { backgroundColor: c.primary, borderColor: c.primary },
  buttonText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: c.textStrong },
  buttonTextActive: { color: c.onColor },
  badge: {
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5,
    alignItems: 'center', justifyContent: 'center', backgroundColor: c.onColor,
  },
  badgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: c.primary },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.background,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '85%', paddingBottom: 28,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: c.border,
    alignSelf: 'center', marginTop: 10, marginBottom: 6,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
  },
  sheetTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: c.text },
  sheetCount: { fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textMuted, marginTop: 1 },
  clearAll: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.primary },
  sheetBody: { paddingHorizontal: 20 },
  block: { paddingVertical: 14 },
  blockDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
  blockHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  blockHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  blockTitle: {
    fontSize: 11, fontFamily: 'Inter_700Bold', color: c.textFaint,
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  blockValue: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.text, flexShrink: 1 },
  blockValueEmpty: { fontFamily: 'Inter_400Regular', color: c.textFaint },
  unratedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  unratedText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: c.textMuted },
  unratedTextActive: { fontFamily: 'Inter_600SemiBold', color: c.primary },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  optionChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
    maxWidth: '100%',
  },
  optionChipPicked: { backgroundColor: c.primary, borderColor: c.primary },
  optionChipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: c.textStrong },
  optionChipTextPicked: { color: c.onColor },
  sheetFooter: {
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
  },
  applyBtn: {
    backgroundColor: c.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center',
  },
  applyBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: c.onColor },
});
