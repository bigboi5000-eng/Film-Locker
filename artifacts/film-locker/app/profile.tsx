import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Alert, ScrollView, ActivityIndicator, Platform, Switch,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth, useUser } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMe,
  useUpdateMe,
  getGetMeQueryKey,
} from '@workspace/api-client-react';
import { confirmDestructive } from '@/lib/confirm';

function Row({
  icon, label, value, danger, onPress,
}: {
  icon: string;
  label: string;
  value?: string;
  danger?: boolean;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
    >
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
        <Ionicons name={icon as any} size={18} color={danger ? '#EF4444' : '#6B7280'} />
      </View>
      <View style={styles.rowContent}>
        <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]}>{label}</Text>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      </View>
      {onPress && (
        <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
      )}
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut } = useAuth();
  const { user: clerkUser } = useUser();
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useGetMe({
    query: { queryKey: getGetMeQueryKey() },
  });

  const { mutateAsync: updateMe, isPending: saving } = useUpdateMe();

  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [editingInitials, setEditingInitials] = useState(false);
  const [initialsInput, setInitialsInput] = useState('');

  const displayName = profile?.username ?? clerkUser?.username ?? clerkUser?.firstName ?? 'You';
  const email = profile?.email ?? clerkUser?.primaryEmailAddress?.emailAddress ?? '';
  const avatarUrl = clerkUser?.imageUrl;
  const initials = (profile?.displayInitials || displayName).slice(0, 5).toUpperCase();

  const handleStartEditUsername = useCallback(() => {
    setUsernameInput(profile?.username ?? '');
    setEditingUsername(true);
  }, [profile?.username]);

  const handleSaveUsername = useCallback(async () => {
    const trimmed = usernameInput.trim();
    if (!trimmed || trimmed.length < 2) {
      Alert.alert('Too short', 'Username must be at least 2 characters.');
      return;
    }
    try {
      await updateMe({ data: { username: trimmed } });
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      setEditingUsername(false);
    } catch {
      Alert.alert('Error', 'Could not update username. Try a different one.');
    }
  }, [usernameInput, updateMe, queryClient]);

  const [togglingPrivacy, setTogglingPrivacy] = useState(false);

  const handleTogglePrivacy = useCallback(async (next: boolean) => {
    setTogglingPrivacy(true);
    try {
      await updateMe({ data: { isPrivate: next } });
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    } catch {
      Alert.alert('Error', 'Could not update account visibility.');
    } finally {
      setTogglingPrivacy(false);
    }
  }, [updateMe, queryClient]);

  const handleStartEditInitials = useCallback(() => {
    setInitialsInput(profile?.displayInitials ?? '');
    setEditingInitials(true);
  }, [profile?.displayInitials]);

  const handleSaveInitials = useCallback(async () => {
    const trimmed = initialsInput.trim().toUpperCase();
    try {
      await updateMe({ data: { displayInitials: trimmed.length > 0 ? trimmed : null } });
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      setEditingInitials(false);
    } catch {
      Alert.alert('Error', 'Could not update display initials.');
    }
  }, [initialsInput, updateMe, queryClient]);

  const handleSignOut = useCallback(() => {
    confirmDestructive('Are you sure you want to sign out?', 'Sign out', async () => {
      await signOut();
      router.replace('/(auth)/sign-in');
    });
  }, [signOut, router]);

  const handleDeleteAccount = useCallback(() => {
    confirmDestructive(
      'This permanently deletes your Film Locker account, watchlist, and all social data. This cannot be undone.',
      'Delete',
      async () => {
        try {
          await clerkUser?.delete();
          router.replace('/(auth)/sign-in');
        } catch {
          Alert.alert('Error', 'Could not delete your account. Please contact support.');
        }
      }
    );
  }, [clerkUser, router]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        {/* Avatar + name */}
        <View style={styles.hero}>
          <View style={styles.avatarWrap}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
            )}
          </View>
          <Text style={styles.heroName}>{displayName}</Text>
          <Text style={styles.heroEmail}>{email}</Text>
        </View>

        {/* Username edit */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Account</Text>

          {editingUsername ? (
            <View style={styles.editRow}>
              <TextInput
                style={styles.textInput}
                value={usernameInput}
                onChangeText={setUsernameInput}
                placeholder="Enter username…"
                placeholderTextColor="#9CA3AF"
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={30}
              />
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleSaveUsername}
                disabled={saving}
                activeOpacity={0.8}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.saveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setEditingUsername(false)}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>
          ) : (
            <Row
              icon="at-outline"
              label="Username"
              value={profile?.username ?? '(not set)'}
              onPress={handleStartEditUsername}
            />
          )}

          {editingInitials ? (
            <View style={styles.editRow}>
              <TextInput
                style={styles.textInput}
                value={initialsInput}
                onChangeText={(t) => setInitialsInput(t.slice(0, 5))}
                placeholder="e.g. JPLT"
                placeholderTextColor="#9CA3AF"
                autoFocus
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={5}
              />
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleSaveInitials}
                disabled={saving}
                activeOpacity={0.8}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.saveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setEditingInitials(false)}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>
          ) : (
            <Row
              icon="text-outline"
              label="Display Initials (Optional)"
              value={profile?.displayInitials ?? 'Derived from username'}
              onPress={handleStartEditInitials}
            />
          )}

          <Row icon="mail-outline" label="Email" value={email} />
        </View>

        {/* Privacy */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Privacy</Text>
          <View style={styles.privacyRow}>
            <View style={styles.rowIcon}>
              <Ionicons name="lock-closed-outline" size={18} color="#6B7280" />
            </View>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Private account</Text>
              <Text style={styles.rowValue}>
                {profile?.isPrivate
                  ? 'Follows need your approval; comments are followers-only'
                  : 'Anyone can follow you and see your comments'}
              </Text>
            </View>
            {togglingPrivacy ? (
              <ActivityIndicator size="small" color="#0066FF" />
            ) : (
              <Switch
                value={Boolean(profile?.isPrivate)}
                onValueChange={handleTogglePrivacy}
                trackColor={{ true: '#0066FF' }}
              />
            )}
          </View>
        </View>

        {/* Danger zone */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Account actions</Text>
          <Row icon="log-out-outline" label="Sign out" onPress={handleSignOut} />
          <Row icon="trash-outline" label="Delete account" danger onPress={handleDeleteAccount} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#111827' },

  hero: { alignItems: 'center', paddingVertical: 32, backgroundColor: '#FFF', marginBottom: 20 },
  avatarWrap: { marginBottom: 12 },
  avatar: { width: 80, height: 80, borderRadius: 40 },
  avatarFallback: { backgroundColor: '#E0E7FF', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 28, fontFamily: 'Inter_700Bold', color: '#4F46E5' },
  heroName: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#111827', marginBottom: 4 },
  heroEmail: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },

  card: {
    backgroundColor: '#FFF', marginHorizontal: 16, marginBottom: 16,
    borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  cardTitle: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold',
    color: '#9CA3AF', letterSpacing: 0.6, textTransform: 'uppercase',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4,
  },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
    borderTopWidth: 1, borderTopColor: '#F3F4F6',
  },
  privacyRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: '#F9FAFB', alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  rowIconDanger: { backgroundColor: '#FEF2F2' },
  rowContent: { flex: 1 },
  rowLabel: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#111827' },
  rowLabelDanger: { color: '#EF4444' },
  rowValue: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginTop: 1 },

  editRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: '#F3F4F6',
  },
  textInput: {
    flex: 1, height: 40, paddingHorizontal: 12,
    backgroundColor: '#F9FAFB', borderRadius: 8,
    borderWidth: 1, borderColor: '#E5E7EB',
    fontSize: 15, fontFamily: 'Inter_400Regular', color: '#111827',
  },
  saveBtn: {
    backgroundColor: '#0066FF', paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 8, minWidth: 56, alignItems: 'center',
  },
  saveBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  cancelBtn: { padding: 8 },
});
