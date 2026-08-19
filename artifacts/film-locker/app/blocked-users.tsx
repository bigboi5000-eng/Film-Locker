import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetBlocks,
  useUnblockUser,
  getGetBlocksQueryKey,
  getGetFollowsQueryKey,
  type PublicUserProfile,
} from '@workspace/api-client-react';
import { useToast } from '@/components/ToastProvider';

export default function BlockedUsersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data, isLoading } = useGetBlocks();
  const { mutateAsync: unblockUser } = useUnblockUser();
  const [busyId, setBusyId] = useState<string | null>(null);

  const blocked = data?.blocked ?? [];

  const handleUnblock = useCallback(async (user: PublicUserProfile) => {
    setBusyId(user.clerkId);
    try {
      await unblockUser({ userId: user.clerkId });
      await queryClient.invalidateQueries({ queryKey: getGetBlocksQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getGetFollowsQueryKey() });
      showToast({ title: `Unblocked ${user.username ?? 'user'}`, variant: 'success' });
    } catch {
      showToast({ title: 'Could not unblock this user', variant: 'error' });
    } finally {
      setBusyId(null);
    }
  }, [unblockUser, queryClient, showToast]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Blocked Users</Text>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0066FF" />
        </View>
      ) : (
        <FlatList
          data={blocked}
          keyExtractor={(u) => u.clerkId}
          renderItem={({ item }) => {
            const initials = (item.displayInitials || item.username || '??').slice(0, 5).toUpperCase();
            const busy = busyId === item.clerkId;
            return (
              <View style={styles.row}>
                {item.avatarUrl ? (
                  <Image source={{ uri: item.avatarUrl }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarText} numberOfLines={1} adjustsFontSizeToFit>{initials}</Text>
                  </View>
                )}
                <Text style={styles.username} numberOfLines={1}>{item.username ?? 'Unnamed user'}</Text>
                {busy ? (
                  <ActivityIndicator size="small" color="#0066FF" />
                ) : (
                  <TouchableOpacity style={styles.unblockBtn} onPress={() => handleUnblock(item)} activeOpacity={0.8}>
                    <Text style={styles.unblockBtnText}>Unblock</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="shield-checkmark-outline" size={48} color="#D1D5DB" />
              <Text style={styles.emptyText}>You haven't blocked anyone.</Text>
            </View>
          }
          contentContainerStyle={blocked.length === 0 ? { flex: 1 } : { paddingBottom: insets.bottom + 24 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  backBtn: { padding: 4, marginRight: 12 },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#111827' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: { backgroundColor: '#E0E7FF', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#4F46E5' },
  username: { flex: 1, fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#111827' },

  unblockBtn: {
    backgroundColor: '#F3F4F6', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  unblockBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#374151' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF', textAlign: 'center' },
});
