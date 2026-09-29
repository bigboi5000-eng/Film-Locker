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
};

const FILTER_KEYS: FilterKey[] = ['genre', 'length', 'director', 'actor', 'language', 'streaming'];

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
    }
  }
  // Bands have a natural order that alphabetical sorting would destroy
  // ("2 – 2½ hr" before "Under 90 min"), so keep them in the declared order.
  if (key === 'length') {
    return LENGTH_BUCKETS.filter((b) => values.has(b.label)).map((b) => b.label);
  }
  return Array.from(values).sort();
}

export function FilterBar({ movies, filters, onChange }: FilterBarProps) {
  const wrapperRef = useRef<View>(null);
  const [pickerKey, setPickerKey] = useState<FilterKey | null>(null);
  const [dropdownTop, setDropdownTop] = useState(200);

  const activeCount = Object.values(filters).filter(Boolean).length;

  const options = useMemo(
    () => (pickerKey ? getOptions(movies, pickerKey) : []),
    [movies, pickerKey]
  );

  const openPicker = useCallback((key: FilterKey) => {
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

  const selectOption = useCallback(
    (value: string) => {
      if (!pickerKey) return;
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
                  color={isActive ? '#FFFFFF' : '#6B7280'}
                  style={{ marginLeft: 4 }}
                />
              </TouchableOpacity>
            );
          })}
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
                {pickerKey ? FILTER_LABELS[pickerKey] : ''}
              </Text>
              <TouchableOpacity onPress={closeDropdown} hitSlop={8}>
                <Ionicons name="close" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {options.length === 0 ? (
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
                        <Ionicons name="checkmark" size={16} color="#0066FF" />
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

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexDirection: 'row' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  chipActive: { backgroundColor: '#0066FF', borderColor: '#0066FF' },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#374151' },
  chipTextActive: { color: '#FFFFFF' },
  // Dropdown
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  dropdownCard: {
    position: 'absolute',
    left: 16,
    backgroundColor: '#FFFFFF',
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
    borderBottomColor: '#E5E7EB',
  },
  dropdownTitle: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: '#111827',
  },
  optionScroll: { maxHeight: 220 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  optionRowActive: { backgroundColor: '#EFF6FF' },
  optionText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#111827',
    flex: 1,
    marginRight: 8,
  },
  optionTextActive: { fontFamily: 'Inter_600SemiBold', color: '#0066FF' },
  emptyDropdown: { padding: 20, alignItems: 'center' },
  emptyDropdownText: { fontSize: 13, color: '#9CA3AF', fontFamily: 'Inter_400Regular' },
});
