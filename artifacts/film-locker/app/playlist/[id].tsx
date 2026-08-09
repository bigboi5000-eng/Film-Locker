import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, Switch, Modal,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  useGetPlaylist,
  useUpdatePlaylist,
  useDeletePlaylist,
  useRemovePlaylistItem,
  getGetPlaylistQueryKey,
  getGetMyPlaylistsQueryKey,
  type PlaylistItem,
} from '@workspace/api-client-react';

function EditSheet({
  visible,
  initialName,
  initialDescription,
  initialIsPublic,
  onSave,
  onDelete,
  onClose,
  saving,
}: {
  visible: boolean;
  initialName: string;
  initialDescription: string | null | undefined;
  initialIsPublic: boolean;
  onSave: (data: { name: string; description: string | null; isPublic: boolean }) => void;
  onDelete: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [isPublic, setIsPublic] = useState(initialIsPublic);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={editStyles.overlay}>
        <TouchableOpacity style={editStyles.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={editStyles.sheet}>
          <View style={editStyles.handle} />
          <Text style={editStyles.title}>Edit Playlist</Text>

          <Text style={editStyles.label}>Name</Text>
          <TextInput
            style={editStyles.input}
            value={name}
            onChangeText={setName}
            placeholder="Playlist name"
            placeholderTextColor="#9CA3AF"
            maxLength={100}
          />

          <Text style={editStyles.label}>Description</Text>
          <TextInput
            style={[editStyles.input, editStyles.inputMultiline]}
            value={description}
            onChangeText={setDescription}
            placeholder="Optional description…"
            placeholderTextColor="#9CA3AF"
            multiline
            numberOfLines={3}
            maxLength={300}
          />

          <View style={editStyles.toggleRow}>
            <View>
              <Text style={editStyles.toggleLabel}>Public playlist</Text>
              <Text style={editStyles.toggleSub}>Anyone can search for and view this</Text>
            </View>
            <Switch
              value={isPublic}
              onValueChange={setIsPublic}
              trackColor={{ true: '#0066FF', false: '#E5E7EB' }}
              thumbColor="#FFF"
            />
          </View>

          <TouchableOpacity
            style={editStyles.saveBtn}
            onPress={() => onSave({ name: name.trim(), description: description.trim() || null, isPublic })}
            disabled={saving || !name.trim()}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={editStyles.saveBtnText}>Save Changes</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={editStyles.deleteBtn} onPress={onDelete} activeOpacity={0.8}>
            <Ionicons name="trash-outline" size={16} color="#EF4444" style={{ marginRight: 6 }} />
            <Text style={editStyles.deleteBtnText}>Delete Playlist</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const editStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#111827', marginBottom: 20 },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#6B7280', marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, fontFamily: 'Inter_400Regular', color: '#111827',
    marginBottom: 16, backgroundColor: '#F9FAFB',
  },
  inputMultiline: { height: 80, textAlignVertical: 'top' },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6', marginBottom: 20,
  },
  toggleLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#111827' },
  toggleSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginTop: 2 },
  saveBtn: { backgroundColor: '#0066FF', padding: 14, borderRadius: 10, alignItems: 'center', marginBottom: 12 },
  saveBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    padding: 14, borderRadius: 10, backgroundColor: '#FEF2F2',
  },
  deleteBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#EF4444' },
});

// ─────────────────────────────────────────────────────────────────────────────

function FilmTile({
  item,
  onRemove,
}: {
  item: PlaylistItem;
  onRemove: (tmdbId: number, title: string) => void;
}) {
  return (
    <View style={styles.tile}>
      <Image source={{ uri: item.posterUrl }} style={styles.tilePoster} contentFit="cover" transition={200} />
      <TouchableOpacity
        style={styles.removeBtn}
        onPress={() => onRemove(item.tmdbId, item.filmTitle)}
        activeOpacity={0.8}
      >
        <Ionicons name="close-circle" size={22} color="#FFF" />
      </TouchableOpacity>
      <View style={styles.tileFooter}>
        <Text style={styles.tileTitle} numberOfLines={2}>{item.filmTitle}</Text>
      </View>
    </View>
  );
}

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const numericId = Number(id);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [editVisible, setEditVisible] = useState(false);

  const { data: playlist, isLoading } = useGetPlaylist(numericId, {
    query: { queryKey: getGetPlaylistQueryKey(numericId), enabled: !isNaN(numericId) },
  });

  const { mutateAsync: updatePlaylist, isPending: saving } = useUpdatePlaylist();
  const { mutateAsync: deletePlaylist } = useDeletePlaylist();
  const { mutateAsync: removeItem } = useRemovePlaylistItem();

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: getGetPlaylistQueryKey(numericId) });
    await queryClient.invalidateQueries({ queryKey: getGetMyPlaylistsQueryKey() });
  }, [queryClient, numericId]);

  const handleSave = useCallback(async (data: { name: string; description: string | null; isPublic: boolean }) => {
    try {
      await updatePlaylist({ id: numericId, data });
      await invalidate();
      setEditVisible(false);
    } catch {
      Alert.alert('Error', 'Could not update playlist.');
    }
  }, [updatePlaylist, numericId, invalidate]);

  const handleDelete = useCallback(() => {
    Alert.alert('Delete playlist', `Delete "${playlist?.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePlaylist({ id: numericId });
            await queryClient.invalidateQueries({ queryKey: getGetMyPlaylistsQueryKey() });
            router.back();
          } catch {
            Alert.alert('Error', 'Could not delete playlist.');
          }
        },
      },
    ]);
  }, [deletePlaylist, numericId, playlist?.name, queryClient, router]);

  const handleRemove = useCallback(async (tmdbId: number, title: string) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await removeItem({ id: numericId, tmdbId });
      await invalidate();
    } catch {
      Alert.alert('Error', `Could not remove "${title}".`);
    }
  }, [removeItem, numericId, invalidate]);

  const items = playlist?.items ?? [];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color="#111827" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          {isLoading ? (
            <ActivityIndicator color="#0066FF" />
          ) : (
            <>
              <Text style={styles.headerTitle} numberOfLines={1}>{playlist?.name ?? 'Playlist'}</Text>
              <View style={styles.headerMeta}>
                <Ionicons
                  name={playlist?.isPublic ? 'globe-outline' : 'lock-closed-outline'}
                  size={12}
                  color="#9CA3AF"
                />
                <Text style={styles.headerMetaText}>
                  {playlist?.isPublic ? 'Public' : 'Private'} · {items.length} film{items.length !== 1 ? 's' : ''}
                </Text>
              </View>
            </>
          )}
        </View>
        <TouchableOpacity onPress={() => setEditVisible(true)} style={styles.editBtn} activeOpacity={0.7}>
          <Ionicons name="pencil-outline" size={20} color="#6B7280" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0066FF" />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="film-outline" size={56} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>Empty playlist</Text>
          <Text style={styles.emptySub}>
            Add films from the watchlist or film detail screens.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          numColumns={2}
          keyExtractor={(item) => String(item.tmdbId)}
          renderItem={({ item }) => (
            <FilmTile item={item} onRemove={handleRemove} />
          )}
          contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24 }}
          columnWrapperStyle={{ gap: 12 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        />
      )}

      {playlist && (
        <EditSheet
          visible={editVisible}
          initialName={playlist.name}
          initialDescription={playlist.description}
          initialIsPublic={playlist.isPublic}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditVisible(false)}
          saving={saving}
        />
      )}
    </View>
  );
}

import { Platform } from 'react-native';

const TILE_W = '47%';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  backBtn: { padding: 4 },
  headerCenter: { flex: 1, marginHorizontal: 12 },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#111827' },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  headerMetaText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },
  editBtn: { padding: 8 },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: '#374151' },
  emptySub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },

  tile: { width: TILE_W, position: 'relative' },
  tilePoster: { width: '100%', aspectRatio: 2 / 3, borderRadius: 10 },
  removeBtn: {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 11,
  },
  tileFooter: { paddingTop: 6, paddingHorizontal: 2, paddingBottom: 4 },
  tileTitle: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#111827', lineHeight: 18 },
});
