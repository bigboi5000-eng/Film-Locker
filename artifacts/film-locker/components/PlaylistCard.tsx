import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { Playlist } from '@workspace/api-client-react';

export function PlaylistCard({ playlist, onPress }: { playlist: Playlist; onPress: () => void }) {
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
                <Ionicons name="film-outline" size={20} color="#D1D5DB" />
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
            color="#9CA3AF"
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

const styles = StyleSheet.create({
  card: { width: 140, marginRight: 12 },
  coverGrid: {
    width: 140, height: 100, borderRadius: 10, overflow: 'hidden',
    flexDirection: 'row', flexWrap: 'wrap',
  },
  coverCell: { width: '50%', height: '50%' },
  coverPlaceholder: { backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  info: { paddingTop: 8, paddingHorizontal: 2 },
  name: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#111827', marginBottom: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },
  owner: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginTop: 2 },
});
