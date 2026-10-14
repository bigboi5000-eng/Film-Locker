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
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

export default function BlockedUsersScreen() {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
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
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Blocked Users</Text>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
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
                  <ActivityIndicator size="small" color={colors.primary} />
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
              <Ionicons name="shield-checkmark-outline" size={48} color={colors.iconFaint} />
              <Text style={styles.emptyText}>You haven't blocked anyone.</Text>
            </View>
          }
          contentContainerStyle={blocked.length === 0 ? { flex: 1 } : { paddingBottom: insets.bottom + 24 }}
        />
      )}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  backBtn: { padding: 4, marginRight: 12 },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: c.text },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: c.surfaceAlt,
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: { backgroundColor: c.avatarBg, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: c.avatarFg },
  username: { flex: 1, fontSize: 15, fontFamily: 'Inter_600SemiBold', color: c.text },

  unblockBtn: {
    backgroundColor: c.surfaceAlt, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: c.border,
  },
  unblockBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.textStrong },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: c.textFaint, textAlign: 'center' },
});
