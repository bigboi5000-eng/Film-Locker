import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, Switch, ActivityIndicator } from 'react-native';
import { webInputReset } from '@/lib/webInputReset';

export function CreatePlaylistModal({
  visible,
  onClose,
  onCreate,
  creating,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (name: string, isPublic: boolean) => void;
  creating: boolean;
}) {
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(false);

  const handleCreate = () => {
    if (!name.trim()) return;
    onCreate(name.trim(), isPublic);
  };

  const handleClose = () => {
    setName('');
    setIsPublic(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} onPress={handleClose} activeOpacity={1} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>New Playlist</Text>

          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Playlist name…"
            placeholderTextColor="#9CA3AF"
            autoFocus
            maxLength={100}
            returnKeyType="done"
            onSubmitEditing={handleCreate}
          />

          <View style={styles.toggleRow}>
            <View>
              <Text style={styles.toggleLabel}>Public</Text>
              <Text style={styles.toggleSub}>Anyone can search for this playlist</Text>
            </View>
            <Switch
              value={isPublic}
              onValueChange={setIsPublic}
              trackColor={{ true: '#0066FF', false: '#E5E7EB' }}
              thumbColor="#FFF"
            />
          </View>

          <TouchableOpacity
            style={[styles.createBtn, (!name.trim() || creating) && styles.createBtnDisabled]}
            onPress={handleCreate}
            disabled={!name.trim() || creating}
            activeOpacity={0.8}
          >
            {creating ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.createBtnText}>Create Playlist</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#111827', marginBottom: 16 },
  input: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontFamily: 'Inter_400Regular', color: '#111827',
    marginBottom: 16, backgroundColor: '#F9FAFB',
    ...webInputReset,
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6', marginBottom: 20,
  },
  toggleLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#111827' },
  toggleSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginTop: 2 },
  createBtn: { backgroundColor: '#0066FF', padding: 14, borderRadius: 10, alignItems: 'center' },
  createBtnDisabled: { opacity: 0.5 },
  createBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
});
