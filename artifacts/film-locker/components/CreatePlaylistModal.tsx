import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, Switch, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { webInputReset } from '@/lib/webInputReset';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

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
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
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
      {/* The sheet sits at the bottom of the screen and autofocuses its input,
          so without this the keyboard opens straight over the field you are
          being asked to type in. Same wrapper and behaviour the other sheets
          use — padding on iOS, height on Android. */}
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={styles.backdrop} onPress={handleClose} activeOpacity={1} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>New Playlist</Text>

          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Playlist name…"
            placeholderTextColor={colors.textFaint}
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
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor={colors.background}
            />
          </View>

          <TouchableOpacity
            style={[styles.createBtn, (!name.trim() || creating) && styles.createBtnDisabled]}
            onPress={handleCreate}
            disabled={!name.trim() || creating}
            activeOpacity={0.8}
          >
            {creating ? (
              <ActivityIndicator color={colors.onColor} />
            ) : (
              <Text style={styles.createBtnText}>Create Playlist</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: c.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: c.text, marginBottom: 16 },
  input: {
    borderWidth: 1, borderColor: c.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontFamily: 'Inter_400Regular', color: c.text,
    marginBottom: 16, backgroundColor: c.surfaceSubtle,
    ...webInputReset,
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.surfaceAlt, marginBottom: 20,
  },
  toggleLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: c.text },
  toggleSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textFaint, marginTop: 2 },
  createBtn: { backgroundColor: c.primary, padding: 14, borderRadius: 10, alignItems: 'center' },
  createBtnDisabled: { opacity: 0.5 },
  createBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: c.onColor },
});
