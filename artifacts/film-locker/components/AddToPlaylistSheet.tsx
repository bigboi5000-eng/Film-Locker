/**
 * AddToPlaylistSheet
 *
 * "Add to Playlist" bottom sheet for a single film — same destination-choice
 * workflow as the multi-film import flow (ShareFilmSheet's BulkAddPanel):
 * pick an existing playlist, or create a new one. Simpler than that one
 * since there's always exactly one film and no selection checklist — tapping
 * a playlist (or creating one) adds the film and closes the sheet.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  ScrollView, ActivityIndicator, TextInput, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMyPlaylists,
  useCreatePlaylist,
  useAddPlaylistItem,
  getGetMyPlaylistsQueryKey,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useToast } from '@/components/ToastProvider';
import { webInputReset } from '@/lib/webInputReset';

interface AddToPlaylistSheetProps {
  visible: boolean;
  tmdbId: number;
  title: string;
  posterUrl: string;
  onClose: () => void;
}

export function AddToPlaylistSheet({ visible, tmdbId, title, posterUrl, onClose }: AddToPlaylistSheetProps) {
  const colors = useColors();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const { data } = useGetMyPlaylists({ query: { queryKey: getGetMyPlaylistsQueryKey(), enabled: visible } });
  const { mutateAsync: addItem } = useAddPlaylistItem();
  const { mutateAsync: createPlaylist, isPending: creating } = useCreatePlaylist();

  const [addingId, setAddingId] = useState<number | null>(null);
  const [newName, setNewName] = useState('');

  const playlists = data?.playlists ?? [];

  const handleAddToExisting = useCallback(async (playlistId: number, playlistName: string) => {
    setAddingId(playlistId);
    try {
      await addItem({ id: playlistId, data: { tmdbId, filmTitle: title, posterUrl } });
      await queryClient.invalidateQueries({ queryKey: getGetMyPlaylistsQueryKey() });
      showToast({ title: `Added to "${playlistName}"`, variant: 'success' });
      onClose();
    } catch {
      showToast({ title: 'Could not add film', subtitle: 'Check your connection and try again.', variant: 'error' });
    } finally {
      setAddingId(null);
    }
  }, [addItem, tmdbId, title, posterUrl, queryClient, showToast, onClose]);

  const handleCreateAndAdd = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const playlist = await createPlaylist({ data: { name, isPublic: false } });
      await addItem({ id: playlist.id, data: { tmdbId, filmTitle: title, posterUrl } });
      await queryClient.invalidateQueries({ queryKey: getGetMyPlaylistsQueryKey() });
      showToast({ title: `Added to "${name}"`, variant: 'success' });
      setNewName('');
      onClose();
    } catch {
      showToast({ title: 'Could not create playlist', variant: 'error' });
    }
  }, [newName, createPlaylist, addItem, tmdbId, title, posterUrl, queryClient, showToast, onClose]);

  return (
    <Modal transparent visible={visible} onRequestClose={onClose} animationType="slide" statusBarTranslucent>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={styles.handleContainer}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
          </View>

          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
              Add "{title}" to a Playlist
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {playlists.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ADD TO EXISTING</Text>
                {playlists.map((pl) => (
                  <TouchableOpacity
                    key={pl.id}
                    style={[styles.plRow, { borderBottomColor: colors.border }]}
                    onPress={() => handleAddToExisting(pl.id, pl.name)}
                    disabled={addingId !== null}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.plIcon, { backgroundColor: colors.muted }]}>
                      <Ionicons name={pl.isPublic ? 'globe-outline' : 'lock-closed-outline'} size={16} color="#6B7280" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.plName, { color: colors.foreground }]} numberOfLines={1}>{pl.name}</Text>
                      <Text style={[styles.plCount, { color: colors.mutedForeground }]}>
                        {pl.itemCount} film{pl.itemCount !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    {addingId === pl.id ? (
                      <ActivityIndicator size="small" color="#0066FF" />
                    ) : (
                      <Ionicons name="add-circle-outline" size={22} color="#0066FF" />
                    )}
                  </TouchableOpacity>
                ))}
              </>
            )}

            <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: playlists.length > 0 ? 20 : 0 }]}>
              {playlists.length > 0 ? 'OR CREATE NEW' : 'NEW PLAYLIST'}
            </Text>
            <View style={styles.newRow}>
              <TextInput
                style={[styles.newInput, { backgroundColor: colors.muted, color: colors.foreground, borderColor: colors.border }]}
                value={newName}
                onChangeText={setNewName}
                placeholder="New playlist name…"
                placeholderTextColor="#9CA3AF"
                maxLength={100}
                returnKeyType="done"
                onSubmitEditing={handleCreateAndAdd}
              />
              <TouchableOpacity
                style={styles.newCreate}
                onPress={handleCreateAndAdd}
                disabled={!newName.trim() || creating || addingId !== null}
                activeOpacity={0.8}
              >
                {creating ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.newCreateText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    maxHeight: '80%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
  },
  handleContainer: { alignItems: 'center', paddingTop: 12, paddingBottom: 8 },
  handle: { width: 38, height: 4, borderRadius: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { flex: 1, fontSize: 16, fontFamily: 'Inter_700Bold' },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  sectionLabel: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.8, marginBottom: 4,
  },
  plRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  plIcon: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  plName: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  plCount: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  newInput: {
    flex: 1, height: 40, paddingHorizontal: 12,
    borderRadius: 8, borderWidth: 1,
    fontSize: 14, fontFamily: 'Inter_400Regular',
    ...webInputReset,
  },
  newCreate: { backgroundColor: '#0066FF', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  newCreateText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
});
