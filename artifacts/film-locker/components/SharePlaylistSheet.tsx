/**
 * Sending a playlist to people.
 *
 * A sibling of ShareToFriendSheet rather than a reuse of it, because the two
 * ask for different things. A film is recommended to one person at a time —
 * tap a name and it has gone, and the next name is a separate thought. A
 * playlist is sent to a GROUP: you decide who should see the list, and then
 * you send it, which is one decision with several names in it.
 *
 * So this multi-selects and sends once. The server takes the recipients as a
 * list for the same reason — a request each would leave a half-sent list
 * when the third one failed.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, Modal, FlatList, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Platform, Alert, KeyboardAvoidingView,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useGetNotificationUsers,
  getGetNotificationUsersQueryKey,
  useSharePlaylist,
  type NotificationUser,
} from '@workspace/api-client-react';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import { useToast } from '@/components/ToastProvider';
import type { Palette } from '@/constants/colors';

interface SharePlaylistSheetProps {
  visible: boolean;
  onClose: () => void;
  playlistId: number;
  playlistName: string;
}

export function SharePlaylistSheet({
  visible,
  onClose,
  playlistId,
  playlistName,
}: SharePlaylistSheetProps) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  const { data, isLoading } = useGetNotificationUsers({
    query: { queryKey: getGetNotificationUsersQueryKey(), enabled: visible },
  });
  const { mutateAsync: share } = useSharePlaylist();

  const users = data?.users ?? [];

  const filtered = useMemo(() => {
    if (!query.trim()) return users;
    const q = query.toLowerCase();
    return users.filter(
      (u) => u.username?.toLowerCase().includes(q) || u.clerkId.toLowerCase().includes(q)
    );
  }, [users, query]);

  const toggle = useCallback((clerkId: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(clerkId)) next.delete(clerkId);
      else next.add(clerkId);
      return next;
    });
  }, []);

  const close = useCallback(() => {
    setQuery('');
    setPicked(new Set());
    setSending(false);
    onClose();
  }, [onClose]);

  const handleSend = useCallback(async () => {
    if (picked.size === 0 || sending) return;
    setSending(true);
    try {
      const result = await share({ id: playlistId, data: { toUserIds: [...picked] } });
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      // The server's count, not the number picked. They can differ — someone
      // blocked either way is dropped silently — and claiming a send that
      // did not happen is worse than a number that needs no explanation.
      const n = result.sent;
      showToast({
        title: n === 1 ? 'Playlist sent' : `Playlist sent to ${n}`,
        subtitle: playlistName,
      });
      close();
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : '';
      Alert.alert('Could not send playlist', detail || 'Please try again.');
      setSending(false);
    }
  }, [picked, sending, share, playlistId, playlistName, showToast, close]);

  function UserRow({ user }: { user: NotificationUser }) {
    const initials = (user.displayInitials || user.username || '?').slice(0, 5).toUpperCase();
    const isPicked = picked.has(user.clerkId);

    return (
      <TouchableOpacity
        style={[styles.userRow, isPicked && styles.userRowPicked]}
        onPress={() => toggle(user.clerkId)}
        activeOpacity={0.7}
      >
        {user.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitials} numberOfLines={1} adjustsFontSizeToFit>
              {initials}
            </Text>
          </View>
        )}
        <Text style={styles.username} numberOfLines={1}>
          {user.username ?? user.clerkId}
        </Text>
        <Ionicons
          name={isPicked ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={isPicked ? colors.primary : colors.textFaint}
        />
      </TouchableOpacity>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} onPress={close} activeOpacity={1} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderText}>
              <Text style={styles.sheetTitle}>Send playlist</Text>
              <Text style={styles.sheetSubtitle} numberOfLines={2}>{playlistName}</Text>
            </View>
            <TouchableOpacity onPress={close} style={styles.closeBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <Ionicons name="search-outline" size={16} color={colors.textFaint} style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Filter people…"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
            />
          </View>

          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 32 }} />
          ) : filtered.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {users.length === 0
                  ? 'Follow people to send playlists to them.'
                  : 'No results match your search.'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(u) => u.clerkId}
              renderItem={({ item }) => <UserRow user={item} />}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
            />
          )}

          {/* Always rendered, so the sheet does not change height as names
              are picked — a footer appearing under the finger moves the list
              out from under it mid-tap. */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.sendBtn, picked.size === 0 && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={picked.size === 0 || sending}
              activeOpacity={0.85}
            >
              {sending ? (
                <ActivityIndicator color={colors.onColor} size="small" />
              ) : (
                <>
                  {/* Outline, matching the Send button in ShareToFriendSheet. The
                      filled glyph is a heavier line than every other send in the
                      app, which is noticeable when the two sheets sit a tap
                      apart. */}
                  <Ionicons name="paper-plane-outline" size={16} color={colors.onColor} />
                  <Text style={styles.sendBtnText}>
                    {picked.size === 0
                      ? 'Choose who to send it to'
                      : picked.size === 1
                        ? 'Send to 1 person'
                        : `Send to ${picked.size} people`}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: c.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    paddingBottom: 32,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: c.border,
    alignSelf: 'center', marginTop: 10, marginBottom: 6,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
  },
  sheetHeaderText: { flex: 1, marginRight: 12 },
  sheetTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: c.text },
  sheetSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: c.textMuted, marginTop: 2 },
  closeBtn: { padding: 4 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 20, marginTop: 12, marginBottom: 4,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: c.surfaceAlt, borderRadius: 10,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: c.text, padding: 0 },
  list: { paddingHorizontal: 12 },
  userRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10,
  },
  userRowPicked: { backgroundColor: c.primarySoft },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.surfaceAlt },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 13, fontFamily: 'Inter_700Bold', color: c.textMuted, paddingHorizontal: 4 },
  username: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: c.text },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: c.textMuted, textAlign: 'center' },
  footer: {
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
  },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.primary, borderRadius: 12, paddingVertical: 14,
  },
  sendBtnDisabled: { backgroundColor: c.border },
  sendBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: c.onColor },
});
