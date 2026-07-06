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
import type { Movie } from '@workspace/api-client-react';

const { width: SCREEN_W } = Dimensions.get('window');
const DROPDOWN_W = SCREEN_W - 32;

export interface FilterState {
  genre?: string;
  director?: string;
  actor?: string;
  language?: string;
  streaming?: string;
}

interface FilterBarProps {
  movies: Movie[];
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
};

const FILTER_KEYS: FilterKey[] = ['genre', 'director', 'actor', 'language', 'streaming'];

/** Apply all active filters to a movie list. */
export function applyFilters(movies: Movie[], filters: FilterState): Movie[] {
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
    return true;
  });
}

/** Extract unique, sorted option values for a given filter key. */
function getOptions(movies: Movie[], key: FilterKey): string[] {
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
