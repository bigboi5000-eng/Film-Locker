import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
  TextInput,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Movie } from '@workspace/api-client-react';

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

/** Apply all active filters to a movie list. */
export function applyFilters(movies: Movie[], filters: FilterState): Movie[] {
  return movies.filter((m) => {
    if (filters.genre && !m.genres.includes(filters.genre)) return false;
    if (filters.director && m.director !== filters.director) return false;
    if (filters.actor && !m.cast.includes(filters.actor)) return false;
    if (filters.language && m.language !== filters.language) return false;
    if (
      filters.streaming &&
      !m.watchProviders.some((p) => p.provider_name === filters.streaming)
    )
      return false;
    return true;
  });
}

/** Extract unique, sorted option values for a given filter key. */
function getOptions(movies: Movie[], key: FilterKey): string[] {
  const values = new Set<string>();
  for (const m of movies) {
    if (key === 'genre') m.genres.forEach((g) => g && values.add(g));
    else if (key === 'director') m.director && values.add(m.director);
    else if (key === 'actor') m.cast.forEach((a) => a && values.add(a));
    else if (key === 'language') m.language && values.add(m.language);
    else if (key === 'streaming')
      m.watchProviders.forEach((p) => p.provider_name && values.add(p.provider_name));
  }
  return Array.from(values).sort();
}

const FILTER_KEYS: FilterKey[] = ['genre', 'director', 'actor', 'language', 'streaming'];

export function FilterBar({ movies, filters, onChange }: FilterBarProps) {
  const [pickerKey, setPickerKey] = useState<FilterKey | null>(null);
  const [search, setSearch] = useState('');
  const insets = useSafeAreaInsets();

  const activeCount = Object.values(filters).filter(Boolean).length;

  const options = useMemo(
    () => (pickerKey ? getOptions(movies, pickerKey) : []),
    [movies, pickerKey]
  );

  const filteredOptions = useMemo(
    () =>
      search.trim()
        ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
        : options,
    [options, search]
  );

  const openPicker = useCallback((key: FilterKey) => {
    setSearch('');
    setPickerKey(key);
  }, []);

  const selectOption = useCallback(
    (value: string) => {
      if (!pickerKey) return;
      onChange({ ...filters, [pickerKey]: value });
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

  return (
    <>
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
        >
          <Text style={[styles.chipText, activeCount === 0 && styles.chipTextActive]}>All</Text>
        </TouchableOpacity>

        {FILTER_KEYS.map((key) => {
          const value = filters[key];
          return (
            <TouchableOpacity
              key={key}
              onPress={() => (value ? clearFilter(key) : openPicker(key))}
              style={[styles.chip, value && styles.chipActive]}
            >
              <Text style={[styles.chipText, value && styles.chipTextActive]}>
                {value ? `${FILTER_LABELS[key]}: ${value}` : FILTER_LABELS[key]}
              </Text>
              {value && (
                <Ionicons
                  name="close"
                  size={12}
                  color="#FFFFFF"
                  style={{ marginLeft: 4 }}
                />
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Option picker modal */}
      <Modal
        visible={pickerKey !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerKey(null)}
      >
        <View style={[styles.modal, { paddingTop: Platform.OS === 'ios' ? 16 : insets.top + 8 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {pickerKey ? FILTER_LABELS[pickerKey] : ''}
            </Text>
            <TouchableOpacity onPress={() => setPickerKey(null)}>
              <Ionicons name="close" size={24} color="#111827" />
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color="#6B7280" style={{ marginRight: 8 }} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search…"
              placeholderTextColor="#9CA3AF"
              style={styles.searchInput}
              autoFocus
            />
          </View>

          {filteredOptions.length === 0 ? (
            <View style={styles.emptyPicker}>
              <Text style={styles.emptyPickerText}>
                {options.length === 0 ? 'No data available yet' : 'No matches'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredOptions}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => selectOption(item)}
                  style={[
                    styles.optionRow,
                    pickerKey && filters[pickerKey] === item && styles.optionRowActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      pickerKey && filters[pickerKey] === item && styles.optionTextActive,
                    ]}
                  >
                    {item}
                  </Text>
                  {pickerKey && filters[pickerKey] === item && (
                    <Ionicons name="checkmark" size={18} color="#0066FF" />
                  )}
                </TouchableOpacity>
              )}
              contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
            />
          )}
        </View>
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
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  chipActive: { backgroundColor: '#0066FF', borderColor: '#0066FF' },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#374151' },
  chipTextActive: { color: '#FFFFFF' },
  // Modal
  modal: { flex: 1, backgroundColor: '#FFFFFF' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#111827' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: '#111827' },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  optionRowActive: { backgroundColor: '#EFF6FF' },
  optionText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: '#111827' },
  optionTextActive: { fontFamily: 'Inter_600SemiBold', color: '#0066FF' },
  emptyPicker: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyPickerText: { fontSize: 15, color: '#9CA3AF', fontFamily: 'Inter_400Regular' },
});
