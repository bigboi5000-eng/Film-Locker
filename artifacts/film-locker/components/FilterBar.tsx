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
  sameSort,
  DEFAULT_SORT,
  type SortKey,
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

/**
 * Each categorical filter holds a SET of accepted values, matched as "any
 * of these".
 *
 * One value each could only ask "is it on Netflix", when the question
 * people actually have is "is it on anything I pay for" — and answering it
 * meant running the filter three times and remembering the three answers.
 * Within a category the values are alternatives, so they are an OR;
 * across categories they still narrow, so those stay an AND.
 */
export type FilterValues = string[];

export interface FilterState {
  genre?: FilterValues;
  director?: FilterValues;
  actor?: FilterValues;
  language?: FilterValues;
  streaming?: FilterValues;
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

/**
 * Included with a subscription, as against rentable or buyable.
 *
 * TMDB returns all three under one list and the filter matched on the
 * provider's NAME alone, so "Prime Video" caught a film that Prime will
 * rent you for three pounds exactly as it caught one the subscription
 * covers — and a service that has only ever rented to you still appeared in
 * the list as somewhere you could watch. That is the one mistake this
 * filter must not make: somebody picks a service they pay for, sits down,
 * and is asked for money.
 *
 * Rent and buy are still shown on the film's own page, where the price is
 * visible and the choice is being made deliberately. They are only excluded
 * from "what can I watch tonight".
 */
function isIncluded(p: { provider_name: string; type?: string }): boolean {
  // Undefined type means a row written before the type was recorded. Those
  // are treated as not-included rather than assumed: a wrong "yes" here
  // costs somebody an evening, a wrong "no" costs them one line in a list.
  return p.type === 'flatrate';
}

/** Minimal shape that both Movie and TmdbMovieCard satisfy after adding genres. */
export interface FilterableMovie {
  genres?: string[];
  director?: string;
  cast?: string[];
  language?: string;
  watchProviders?: Array<{ provider_name: string; type?: string }>;
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

/** The slider never collapses below this, or it has nothing to travel. */
const MIN_RUNTIME_SPAN = 60;

export interface RuntimeBounds {
  min: number;
  max: number;
  steps: number;
  tickEvery: number;
}

/**
 * The runtime slider's ends, taken from the films in front of it.
 *
 * A fixed nought-to-four-hours spent most of its travel on lengths nobody
 * owns: a locker of ordinary features is all between ninety minutes and two
 * and a half hours, and on a fixed scale that is a third of the track, with
 * single steps shunting the result by dozens of films.
 *
 * Derived, the whole width is the range you actually have. The ends are
 * rounded outwards to a round ten minutes so they read as numbers rather
 * than as whichever film happens to be shortest, and the span is held to at
 * least an hour so a locker of near-identical lengths still has a slider
 * rather than a dot.
 *
 * The cost is that the ends move as the locker does. That is the right
 * trade for a control you look at while using it — what it cannot do is
 * change under a filter already set, which is why the caller clamps.
 */
/**
 * A stored span, brought inside bounds that may have moved since it was set.
 *
 * Clamping each end on its own is not enough: a span of five to seven hours
 * against a locker whose longest film is now under three gives a lower end
 * above its upper one — a range that matches nothing, reads as nonsense,
 * and cannot be dragged back because both handles are off the track.
 *
 * A span with nothing left inside the bounds is no longer a question the
 * list can answer, so it opens out rather than quietly excluding
 * everything.
 */
export function clampRuntime(
  filters: FilterState,
  bounds: RuntimeBounds
): { lo: number; hi: number } {
  const lo = Math.max(filters.runtimeMin ?? bounds.min, bounds.min);
  const hi = Math.min(filters.runtimeMax ?? bounds.max, bounds.max);
  if (lo > hi) return { lo: bounds.min, hi: bounds.max };
  return { lo, hi };
}

export function runtimeBounds(movies: FilterableMovie[]): RuntimeBounds {
  const known = movies
    .map((m) => m.runtime)
    .filter((r): r is number => typeof r === 'number' && r > 0);

  if (known.length === 0) {
    return { min: 0, max: RUNTIME_MAX, steps: RUNTIME_STEPS, tickEvery: 60 };
  }

  let min = Math.floor(Math.min(...known) / 10) * 10;
  let max = Math.ceil(Math.max(...known) / 10) * 10;

  if (max - min < MIN_RUNTIME_SPAN) {
    const grow = MIN_RUNTIME_SPAN - (max - min);
    min = Math.max(0, min - Math.floor(grow / 2));
    max = min + MIN_RUNTIME_SPAN;
  }

  // Ten-minute steps across whatever the span turned out to be, and a tick
  // every half hour unless that would crowd the track.
  const steps = Math.max(1, Math.round((max - min) / 10));
  const tickEvery = max - min > 180 ? 60 : 30;
  return { min, max, steps, tickEvery };
}

/** "1h 30m", "2h", "45m" — the way anybody says a running time. */
export function formatRuntime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** The span in words, or "Any" when both ends are home. */
export function formatRuntimeRange(min: number, max: number, bounds: RuntimeBounds): string {
  const open = min <= bounds.min;
  const full = max >= bounds.max;
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
function inRuntimeSpan(
  runtime: number | null | undefined,
  min: number,
  max: number,
  bounds: RuntimeBounds
): boolean {
  const open = min <= bounds.min && max >= bounds.max;
  if (open) return true;
  if (typeof runtime !== 'number' || runtime <= 0) return false;
  // A film at or past either end counts as being at it, so the ends mean
  // "and shorter" and "and longer" rather than excluding the very films
  // that set them.
  const clamped = Math.min(Math.max(runtime, bounds.min), bounds.max);
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
   * Which orders this screen can offer. A watchlist has no "date watched",
   * a TMDB list has no "date added", and a playlist has an order of its own
   * that beats all of them.
   */
  sortOptions?: SortKey[];
  /** The order this screen rests in, against which the button reads unset. */
  sortDefault?: SortState;
  /** What "as listed" is called here — "Trending order", and so on. */
  sortDefaultLabel?: string;
}

/** The filters that pick a value from the films in front of them. */
type ChipKey = 'genre' | 'director' | 'actor' | 'language' | 'streaming';

const FILTER_LABELS: Record<ChipKey, string> = {
  genre: 'Genre',
  director: 'Director',
  actor: 'Actor',
  language: 'Language',
  streaming: 'Included with',
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
  // Derived from the same list being filtered, so "both ends home" means
  // the same thing here as it does on the slider the user is looking at.
  const bounds = runtimeBounds(movies);
  const runtime = clampRuntime(filters, bounds);
  return movies.filter((m) => {
    const genres = m.genres ?? [];
    const cast = m.cast ?? [];
    const providers = m.watchProviders ?? [];
    // Any of the chosen values matches; an empty or absent set asks nothing.
    const anyOf = (chosen: FilterValues | undefined, has: (v: string) => boolean) =>
      !chosen || chosen.length === 0 || chosen.some(has);

    if (!anyOf(filters.genre, (g) => genres.includes(g))) return false;
    if (!anyOf(filters.director, (d) => m.director === d)) return false;
    if (!anyOf(filters.actor, (a) => cast.includes(a))) return false;
    if (!anyOf(filters.language, (l) => m.language === l)) return false;
    if (!anyOf(filters.streaming, (svc) =>
      providers.some((p) => isIncluded(p) && p.provider_name === svc))) return false;
    if (!inRuntimeSpan(m.runtime, runtime.lo, runtime.hi, bounds)) return false;
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
      providers.forEach((p) => isIncluded(p) && p.provider_name && values.add(p.provider_name));
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
  sortOptions,
  sortDefault = DEFAULT_SORT,
  sortDefaultLabel,
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
  /**
   * The slider's ends, from the films on this screen.
   *
   * Clamped on the way out, because the ends move as the locker does: a
   * span set when the longest film was three hours must not sit outside the
   * track after that film is removed, where it cannot be dragged back.
   */
  const bounds = useMemo(() => runtimeBounds(movies), [movies]);
  const { lo: runtimeLo, hi: runtimeHi } = clampRuntime(filters, bounds);
  const runtimeActive = runtimeLo > bounds.min || runtimeHi < bounds.max;

  const activeCount =
    FILTER_KEYS.filter((k) => (filters[k]?.length ?? 0) > 0).length +
    (ratingActive ? 1 : 0) +
    (runtimeActive ? 1 : 0);

  const setRuntime = useCallback(
    (min: number, max: number) => {
      const next = { ...filters };
      // An end sitting at its limit is deleted rather than stored, so "the
      // whole range" and "no filter" are one state — which matters more
      // here than for the ratings, since the limits themselves move.
      if (min > bounds.min) next.runtimeMin = min; else delete next.runtimeMin;
      if (max < bounds.max) next.runtimeMax = max; else delete next.runtimeMax;
      onChange(next);
    },
    [filters, onChange, bounds]
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

  /** Add or remove one value from a category's set. */
  const selectValue = useCallback(
    (key: ChipKey, value: string) => {
      const chosen = filters[key] ?? [];
      const next = { ...filters };
      const without = chosen.filter((v) => v !== value);
      // The last value removed deletes the key, so "nothing chosen" and
      // "not filtering" stay one state and the active count needs no
      // special case for an empty array.
      if (without.length === chosen.length) next[key] = [...chosen, value];
      else if (without.length === 0) delete next[key];
      else next[key] = without;
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
            style={[styles.button, !sameSort(sort, sortDefault) && styles.buttonActive]}
            onPress={() => setSortOpen(true)}
            activeOpacity={0.75}
          >
            <Ionicons
              name="swap-vertical-outline"
              size={16}
              color={!sameSort(sort, sortDefault) ? colors.onColor : colors.textStrong}
            />
            <Text
              style={[styles.buttonText, !sameSort(sort, sortDefault) && styles.buttonTextActive]}
              numberOfLines={1}
            >
              {sameSort(sort, sortDefault) ? 'Sort' : describeSort(sort, sortDefaultLabel)}
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
                    {formatRuntimeRange(runtimeLo, runtimeHi, bounds)}
                  </Text>
                </View>
                {/* Offset by the lower bound, because the slider measures
                    from nought and the scale starts wherever the shortest
                    film does. */}
                <RangeSlider
                  min={runtimeLo - bounds.min}
                  max={runtimeHi - bounds.min}
                  onChange={(lo, hi) => setRuntime(lo + bounds.min, hi + bounds.min)}
                  width={SLIDER_W}
                  maxValue={bounds.max - bounds.min}
                  steps={bounds.steps}
                  tickEvery={bounds.tickEvery}
                />
                <View style={styles.scaleRow}>
                  <Text style={styles.scaleEnd}>{formatRuntime(bounds.min)}</Text>
                  <Text style={styles.scaleEnd}>{formatRuntime(bounds.max)}</Text>
                </View>
              </View>

              {/* The categorical ones, as rows that open in place. One at a
                  time, because a thousand actors expanded under six other
                  open sections is a scroll nobody can navigate. */}
              {FILTER_KEYS.map((key) => {
                const options = getOptions(movies, key);
                const chosen = filters[key] ?? [];
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
                          style={[styles.blockValue, chosen.length === 0 && styles.blockValueEmpty]}
                          numberOfLines={1}
                        >
                          {/* Named while they fit, counted once they do
                              not: "Netflix, Prime" reads at a glance and
                              seven service names do not. */}
                          {chosen.length === 0
                            ? options.length === 0
                              ? 'None yet'
                              : 'Any'
                            : chosen.length <= 2
                              ? chosen.join(', ')
                              : `${chosen.length} chosen`}
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
                          const picked = chosen.includes(opt);
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
          options={sortOptions ?? ['added', 'myRating', 'tmdbRating', 'runtime', 'title', 'year']}
          defaultLabel={sortDefaultLabel}
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
  scaleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  scaleEnd: { fontSize: 11, fontFamily: 'Inter_400Regular', color: c.textFaint },
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
