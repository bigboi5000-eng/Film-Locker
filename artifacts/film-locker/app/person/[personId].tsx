import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGetPerson, getGetPersonQueryKey, type TmdbMovieCard } from '@workspace/api-client-react';
import { FilmDetailModal } from '@/components/FilmDetailModal';

/**
 * A director or actor, and everything they have made.
 *
 * Both filmographies come back from the API because plenty of people do
 * both. Which one leads is decided here: somebody with directing credits is
 * almost always being looked up as a director, so those come first and the
 * acting roles become the footnote rather than the other way round.
 */
/** Past this many films, a heading offers to open out into a grid. */
const GRID_THRESHOLD = 5;

const GRID_COLUMNS = 3;
const GRID_GAP = 10;

/**
 * Three columns, measured once. The section has 20px of padding either side
 * and the cards sit GRID_GAP apart, so two gaps come out of the remainder.
 *
 * Floored, then a pixel taken off. The exact division fits precisely — three
 * cards and two gaps came to the available width to the point — and a layout
 * that only just fits does not, because any sub-pixel rounding pushes the
 * third card onto the next line and the grid silently becomes two wide.
 */
const GRID_CARD_WIDTH =
  Math.floor(
    (Dimensions.get('window').width - 40 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS
  ) - 1;

export default function PersonScreen() {
  const { personId } = useLocalSearchParams<{ personId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const id = Number(personId);

  const [selected, setSelected] = useState<TmdbMovieCard | null>(null);

  /** Which filmographies the user has opened out into a grid. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: person, isLoading, isError } = useGetPerson(id, {
    query: { queryKey: getGetPersonQueryKey(id), enabled: Number.isInteger(id) && id > 0 },
  });

  const sections = useMemo(() => {
    if (!person) return [];
    const out: Array<{ key: string; title: string; films: TmdbMovieCard[] }> = [];
    if (person.directed.length > 0) {
      out.push({ key: 'directed', title: 'Directed', films: person.directed });
    }
    if (person.actedIn.length > 0) {
      out.push({
        key: 'acted',
        title: person.directed.length > 0 ? 'Also appeared in' : 'Films',
        films: person.actedIn,
      });
    }
    return out;
  }, [person]);

  /**
   * True when this person has only one filmography — an actor who has never
   * directed, or a director who has never acted. With nothing below it to
   * scroll to, a horizontal strip just hides most of their work.
   */
  const soleSection = sections.length === 1;

  if (isLoading) {
    return (
      <View style={[styles.root, styles.centred]}>
        <ActivityIndicator color="#0066FF" />
      </View>
    );
  }

  if (isError || !person) {
    return (
      <View style={[styles.root, styles.centred, { paddingTop: insets.top }]}>
        <Text style={styles.errorTitle}>Couldn&apos;t load that person</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backLink} activeOpacity={0.7}>
          <Text style={styles.backLinkText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{person.name}</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.identity}>
          {person.profileUrl ? (
            <Image source={{ uri: person.profileUrl }} style={styles.portrait} contentFit="cover" />
          ) : (
            <View style={[styles.portrait, styles.portraitFallback]}>
              <Ionicons name="person" size={34} color="#9CA3AF" />
            </View>
          )}
          <Text style={styles.name}>{person.name}</Text>
          {person.knownFor ? <Text style={styles.knownFor}>{person.knownFor}</Text> : null}
        </View>

        {person.biography ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Biography</Text>
            <Text style={styles.bio} numberOfLines={6}>{person.biography}</Text>
          </View>
        ) : null}

        {sections.map((section) => {
          // One filmography means there is nothing to scroll past to reach
          // anything else, so it gets the whole page as a grid — a director
          // who has never acted should not have their work in a strip.
          //
          // With two, the grid is opt-in: tapping a heading opens that
          // filmography out. Only offered past five films, below which a
          // horizontal row shows most of them anyway and the control would
          // be clutter.
          const asGrid = soleSection || expanded[section.key] === true;
          const canExpand = !soleSection && section.films.length > GRID_THRESHOLD;

          const card = (item: TmdbMovieCard, width?: number) => (
            <TouchableOpacity
              key={`${section.key}-${item.tmdbId}`}
              style={[styles.card, width ? { width } : null]}
              onPress={() => setSelected(item)}
              activeOpacity={0.8}
            >
              <Image
                source={{ uri: item.posterUrl }}
                style={[styles.poster, width ? { width, height: width * 1.5 } : null]}
                contentFit="cover"
              />
              <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.cardYear}>{item.releaseYear}</Text>
            </TouchableOpacity>
          );

          return (
            <View key={section.key} style={styles.section}>
              <TouchableOpacity
                onPress={() => canExpand && setExpanded((e) => ({ ...e, [section.key]: !asGrid }))}
                disabled={!canExpand}
                activeOpacity={0.7}
                style={styles.sectionHeader}
              >
                <Text style={styles.sectionTitle}>
                  {section.title} ({section.films.length})
                </Text>
                {canExpand ? (
                  <Ionicons
                    name={asGrid ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color="#0066FF"
                  />
                ) : null}
              </TouchableOpacity>

              {asGrid ? (
                // A wrapping View rather than a FlatList with numColumns:
                // this page is already a ScrollView, and a vertical
                // VirtualizedList inside one breaks its own virtualisation
                // and warns about it. A filmography is tens of items, not
                // thousands, so there is nothing to virtualise anyway.
                <View style={styles.grid}>
                  {section.films.map((item) => card(item, GRID_CARD_WIDTH))}
                </View>
              ) : (
                <FlatList
                  data={section.films}
                  horizontal
                  keyExtractor={(m) => `${section.key}-${m.tmdbId}`}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 10, paddingVertical: 4 }}
                  renderItem={({ item }) => card(item)}
                />
              )}
            </View>
          );
        })}

        {sections.length === 0 && (
          <View style={styles.section}>
            <Text style={styles.bio}>No films listed for this person on TMDB.</Text>
          </View>
        )}
      </ScrollView>

      {selected && (
        <FilmDetailModal
          visible
          onClose={() => setSelected(null)}
          tmdbId={selected.tmdbId}
          title={selected.title}
          posterUrl={selected.posterUrl}
          releaseYear={selected.releaseYear}
          overview={selected.overview}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  centred: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  backBtn: { padding: 6 },
  headerTitle: { flex: 1, fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#111827', marginLeft: 4 },
  identity: { alignItems: 'center', paddingTop: 24, paddingHorizontal: 24 },
  portrait: { width: 110, height: 110, borderRadius: 55, backgroundColor: '#F3F4F6' },
  portraitFallback: { alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#111827', marginTop: 14, textAlign: 'center' },
  knownFor: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#6B7280', marginTop: 4 },
  section: { paddingHorizontal: 20, marginTop: 26 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#111827' },
  // GRID_GAP, not a literal: the card width is derived from it, so a change
  // here with the constant left behind is how three columns become two.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  bio: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#4B5563', lineHeight: 21 },
  card: { width: 112 },
  poster: { width: 112, height: 168, borderRadius: 8, backgroundColor: '#F3F4F6' },
  cardTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#111827', marginTop: 6 },
  cardYear: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginTop: 1 },
  errorTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#111827' },
  backLink: { marginTop: 12 },
  backLinkText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#0066FF' },
});
