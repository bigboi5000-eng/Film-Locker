/**
 * Sorting, as its own sheet beside the filter one.
 *
 * Filtering and sorting are different questions — which films, and in what
 * order — and conflating them into one control makes both harder to find.
 * Two buttons, two sheets, the same shape.
 */
import React, { useCallback } from 'react';
import { View, Text, Modal, Pressable, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

export type SortKey =
  | 'added'
  | 'watched'
  | 'myRating'
  | 'tmdbRating'
  | 'runtime'
  | 'title'
  | 'year';

export interface SortState {
  key: SortKey;
  /** `desc` is "most/newest/longest first" for every key except title. */
  direction: 'asc' | 'desc';
}

/** What the list arrives in, and what it goes back to when sort is cleared. */
export const DEFAULT_SORT: SortState = { key: 'added', direction: 'desc' };

/**
 * The orders worth offering, with the words each one actually means.
 *
 * "Ascending" and "descending" are the wrong labels for most of these — a
 * descending date is "newest first" and a descending runtime is "longest
 * first", and nobody translates that in their head mid-task. Each option
 * carries its own pair.
 */
export const SORT_OPTIONS: Array<{
  key: SortKey;
  label: string;
  desc: string;
  asc: string;
  /** Only meaningful once a film has been watched. */
  watchedOnly?: boolean;
}> = [
  { key: 'added',      label: 'Date added',    desc: 'Newest first',   asc: 'Oldest first' },
  { key: 'watched',    label: 'Date watched',  desc: 'Newest first',   asc: 'Oldest first', watchedOnly: true },
  { key: 'myRating',   label: 'Your rating',   desc: 'Highest first',  asc: 'Lowest first' },
  { key: 'tmdbRating', label: 'TMDB rating',   desc: 'Highest first',  asc: 'Lowest first' },
  { key: 'runtime',    label: 'Runtime',       desc: 'Longest first',  asc: 'Shortest first' },
  { key: 'title',      label: 'Title',         desc: 'Z to A',         asc: 'A to Z' },
  { key: 'year',       label: 'Release year',  desc: 'Newest first',   asc: 'Oldest first' },
];

/** Everything a sort might read. All optional — a list may not have it. */
export interface SortableMovie {
  title?: string;
  releaseYear?: string;
  runtime?: number | null;
  tmdbRating?: number | null;
  rating?: number | null;
  addedAt?: string;
  watchedAt?: string | null;
}

/** The current order, said the way the button should say it. */
export function describeSort(sort: SortState): string {
  const opt = SORT_OPTIONS.find((o) => o.key === sort.key);
  if (!opt) return 'Sort';
  return opt.label;
}

export function isDefaultSort(sort: SortState): boolean {
  return sort.key === DEFAULT_SORT.key && sort.direction === DEFAULT_SORT.direction;
}

/**
 * Order a list.
 *
 * Films missing the value being sorted on go to the END whichever way round
 * the sort runs. An unrated film is not the worst film and a film with no
 * runtime is not the shortest; sinking them keeps a sort from being a
 * backwards way of listing what is missing.
 */
export function applySort<T extends SortableMovie>(movies: T[], sort: SortState): T[] {
  const dir = sort.direction === 'asc' ? 1 : -1;

  const value = (m: T): number | string | null => {
    switch (sort.key) {
      case 'added': return m.addedAt ? Date.parse(m.addedAt) : null;
      case 'watched': return m.watchedAt ? Date.parse(m.watchedAt) : null;
      case 'myRating': return typeof m.rating === 'number' ? m.rating : null;
      case 'tmdbRating': return typeof m.tmdbRating === 'number' ? m.tmdbRating : null;
      case 'runtime': return typeof m.runtime === 'number' && m.runtime > 0 ? m.runtime : null;
      case 'title': return m.title?.trim().toLowerCase() || null;
      case 'year': {
        const y = Number.parseInt(m.releaseYear ?? '', 10);
        return Number.isFinite(y) ? y : null;
      }
      default: return null;
    }
  };

  // A copy: the caller's array is usually query data, which must not be
  // reordered underneath React Query's cache.
  return [...movies].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;   // missing sinks, regardless of direction
    if (bv === null) return -1;
    if (typeof av === 'string' || typeof bv === 'string') {
      return String(av).localeCompare(String(bv)) * dir;
    }
    return (av - bv) * dir;
  });
}

interface SortSheetProps {
  visible: boolean;
  onClose: () => void;
  sort: SortState;
  onChange: (sort: SortState) => void;
  /** Hides orders that say nothing about an unwatched list. */
  showWatchedOptions?: boolean;
}

export function SortSheet({ visible, onClose, sort, onChange, showWatchedOptions }: SortSheetProps) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const pick = useCallback(
    (key: SortKey) => {
      // Choosing the order you already have flips it, so the second tap is
      // the one anybody reaches for next and not a separate control.
      if (key === sort.key) {
        onChange({ key, direction: sort.direction === 'desc' ? 'asc' : 'desc' });
        return;
      }
      // A new key starts in the direction that key is usually wanted in:
      // newest films, highest ratings, longest runtimes — but titles A to Z.
      onChange({ key, direction: key === 'title' ? 'asc' : 'desc' });
    },
    [sort, onChange]
  );

  const options = SORT_OPTIONS.filter((o) => !o.watchedOnly || showWatchedOptions);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Sort by</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView bounces={false}>
            {options.map((o) => {
              const active = o.key === sort.key;
              return (
                <TouchableOpacity
                  key={o.key}
                  style={[styles.row, active && styles.rowActive]}
                  onPress={() => pick(o.key)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={active ? colors.primary : colors.textFaint}
                  />
                  <Text style={[styles.rowLabel, active && styles.rowLabelActive]}>{o.label}</Text>
                  {active ? (
                    <View style={styles.dirChip}>
                      <Ionicons
                        name={sort.direction === 'desc' ? 'arrow-down' : 'arrow-up'}
                        size={12}
                        color={colors.primary}
                      />
                      <Text style={styles.dirText}>
                        {sort.direction === 'desc' ? o.desc : o.asc}
                      </Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
            <Text style={styles.hint}>Tap the selected order again to reverse it.</Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.background,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: 32, maxHeight: '80%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: c.border,
    alignSelf: 'center', marginTop: 10, marginBottom: 6,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
  },
  title: { fontSize: 17, fontFamily: 'Inter_700Bold', color: c.text },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 14,
  },
  rowActive: { backgroundColor: c.primarySoft },
  rowLabel: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: c.text },
  rowLabelActive: { fontFamily: 'Inter_600SemiBold', color: c.primary },
  dirChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dirText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: c.primary },
  hint: {
    fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textFaint,
    paddingHorizontal: 20, paddingTop: 14,
  },
});
