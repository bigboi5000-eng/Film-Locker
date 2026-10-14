import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { Playlist } from '@workspace/api-client-react';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

export function PlaylistCard({ playlist, onPress }: { playlist: Playlist; onPress: () => void }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const covers = playlist.coverPosters ?? [];
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.coverGrid}>
        {[0, 1, 2, 3].map((i) => (
          covers[i] ? (
            <Image key={i} source={{ uri: covers[i] }} style={styles.coverCell} contentFit="cover" />
          ) : (
            <View key={i} style={[styles.coverCell, styles.coverPlaceholder]}>
              {i === 0 && covers.length === 0 && (
                <Ionicons name="film-outline" size={20} color={colors.iconFaint} />
              )}
            </View>
          )
        ))}
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{playlist.name}</Text>
        <View style={styles.meta}>
          <Ionicons
            name={playlist.isPublic ? 'globe-outline' : 'lock-closed-outline'}
            size={11}
            color={colors.textFaint}
          />
          <Text style={styles.metaText}>{playlist.itemCount} film{playlist.itemCount !== 1 ? 's' : ''}</Text>
        </View>
        {playlist.ownerUsername ? (
          <Text style={styles.owner} numberOfLines={1}>by {playlist.ownerUsername}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  card: { width: 140, marginRight: 12 },
  coverGrid: {
    width: 140, height: 100, borderRadius: 10, overflow: 'hidden',
    flexDirection: 'row', flexWrap: 'wrap',
  },
  coverCell: { width: '50%', height: '50%' },
  coverPlaceholder: { backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  info: { paddingTop: 8, paddingHorizontal: 2 },
  name: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.text, marginBottom: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: c.textFaint },
  owner: { fontSize: 11, fontFamily: 'Inter_400Regular', color: c.textFaint, marginTop: 2 },
});
