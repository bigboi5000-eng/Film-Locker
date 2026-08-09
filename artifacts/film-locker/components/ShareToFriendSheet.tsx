/**
 * ShareToFriendSheet
 *
 * Bottom-sheet style modal for recommending a film to one of the
 * people you follow. Shows a searchable list of followers; tapping
 * a person sends the recommendation.
 *
 * Usage:
 *   <ShareToFriendSheet
 *     visible={shareVisible}
 *     onClose={() => setShareVisible(false)}
 *     tmdbId={movie.tmdbId}
 *     filmTitle={movie.title}
 *     posterUrl={movie.posterUrl}
 *   />
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  FlatList, TextInput, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  useGetNotificationUsers,
  getGetNotificationUsersQueryKey,
  useSendNotification,
  type NotificationUser,
} from '@workspace/api-client-react';

interface ShareToFriendSheetProps {
  visible: boolean;
  onClose: () => void;
  tmdbId: number;
  filmTitle: string;
  posterUrl: string;
}

export function ShareToFriendSheet({
  visible,
  onClose,
  tmdbId,
  filmTitle,
  posterUrl,
}: ShareToFriendSheetProps) {
  const [query, setQuery] = useState('');
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  const { data, isLoading } = useGetNotificationUsers({ query: { queryKey: getGetNotificationUsersQueryKey(), enabled: visible } });
  const { mutateAsync: send } = useSendNotification();

  const users = data?.users ?? [];

  const filtered = useMemo(() => {
    if (!query.trim()) return users;
    const q = query.toLowerCase();
    return users.filter(
      (u) =>
        u.username?.toLowerCase().includes(q) ||
        u.clerkId.toLowerCase().includes(q)
    );
  }, [users, query]);

  const handleSend = useCallback(
    async (user: NotificationUser) => {
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setSendingTo(user.clerkId);
      try {
        await send({
          data: { toUserId: user.clerkId, tmdbId, filmTitle, posterUrl },
        });
        setSentTo((prev) => new Set([...prev, user.clerkId]));
      } catch (err: any) {
        Alert.alert('Error', err?.message ?? 'Could not send recommendation.');
      } finally {
        setSendingTo(null);
      }
    },
    [send, tmdbId, filmTitle, posterUrl]
  );

  function handleClose() {
    setQuery('');
    setSentTo(new Set());
    onClose();
  }

  function UserRow({ user }: { user: NotificationUser }) {
    const initials = (user.username ?? '?').slice(0, 2).toUpperCase();
    const alreadySent = sentTo.has(user.clerkId);
    const sending = sendingTo === user.clerkId;

    return (
      <View style={styles.userRow}>
        {user.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
        )}
        <Text style={styles.username}>{user.username ?? 'Unknown'}</Text>
        {sending ? (
          <ActivityIndicator size="small" color="#0066FF" />
        ) : alreadySent ? (
          <View style={styles.sentBadge}>
            <Ionicons name="checkmark" size={14} color="#059669" />
            <Text style={styles.sentText}>Sent!</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.sendBtn}
            onPress={() => handleSend(user)}
            activeOpacity={0.8}
          >
            <Ionicons name="paper-plane-outline" size={14} color="#FFF" style={{ marginRight: 4 }} />
            <Text style={styles.sendBtnText}>Send</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} onPress={handleClose} activeOpacity={1} />
        <View style={styles.sheet}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderInfo}>
              <Image source={{ uri: posterUrl }} style={styles.filmPoster} contentFit="cover" />
              <View style={styles.sheetHeaderText}>
                <Text style={styles.sheetTitle}>Recommend film</Text>
                <Text style={styles.sheetFilm} numberOfLines={2}>{filmTitle}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchRow}>
            <Ionicons name="search-outline" size={16} color="#9CA3AF" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Filter people…"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
            />
          </View>

          {/* List */}
          {isLoading ? (
            <ActivityIndicator color="#0066FF" style={{ marginVertical: 32 }} />
          ) : filtered.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {users.length === 0
                  ? 'Follow people to recommend films to them.'
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
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    paddingBottom: 32,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#E5E7EB', alignSelf: 'center', marginTop: 10, marginBottom: 8,
  },

  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  sheetHeaderInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  filmPoster: { width: 36, height: 54, borderRadius: 6, marginRight: 10 },
  sheetHeaderText: { flex: 1 },
  sheetTitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginBottom: 2 },
  sheetFilm: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#111827' },
  closeBtn: { padding: 4, marginLeft: 8 },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginVertical: 12,
    backgroundColor: '#F9FAFB', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: '#111827' },

  list: { flex: 1 },

  userRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#F9FAFB',
  },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 12 },
  avatarFallback: { backgroundColor: '#E0E7FF', alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#4F46E5' },
  username: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: '#111827' },

  sendBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0066FF', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  sendBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  sentBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#ECFDF5', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
  },
  sentText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#059669' },

  empty: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },
});
