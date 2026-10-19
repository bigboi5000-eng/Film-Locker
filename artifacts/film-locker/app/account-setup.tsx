import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useGetMe, useUpdateMe, getGetMeQueryKey } from '@workspace/api-client-react';
import { useToast } from '@/components/ToastProvider';
import { webInputReset } from '@/lib/webInputReset';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

/**
 * Shown once, straight after the welcome tour, so the first thing someone
 * does is make their account theirs rather than discovering these settings
 * weeks later buried in Profile.
 *
 * Everything here is optional. The username arrives already filled in,
 * generated from the email at sign-in, so skipping leaves a working,
 * attributable account rather than a nameless one — which is what lets this
 * screen have a Skip button at all.
 *
 * Nothing about this screen gates access to the app. It is reached only
 * after signing in, so it is not a registration wall, and Skip goes
 * straight through.
 */
export default function AccountSetupScreen() {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: profile, isLoading } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const { mutateAsync: updateMe, isPending: saving } = useUpdateMe();

  const [username, setUsername] = useState('');
  const [initials, setInitials] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed from whatever the server already holds, once it arrives. The
  // username is never blank by this point — it is generated at sign-in — so
  // this shows people the name they already have rather than an empty box
  // implying they must invent one.
  useEffect(() => {
    if (!profile) return;
    setUsername(profile.username ?? '');
    setInitials(profile.displayInitials ?? '');
    setIsPrivate(Boolean(profile.isPrivate));
  }, [profile]);

  const finish = () => router.replace('/(tabs)');

  const handleSave = async () => {
    const trimmedName = username.trim();
    const trimmedInitials = initials.trim();

    if (trimmedName.length < 2 || trimmedName.length > 30) {
      setError('Your username needs to be between 2 and 30 characters.');
      return;
    }

    setError(null);
    try {
      await updateMe({
        data: {
          username: trimmedName,
          displayInitials: trimmedInitials.length > 0 ? trimmedInitials : null,
          isPrivate,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      finish();
    } catch (err) {
      // A taken username is the one failure here someone can act on, and the
      // API says so with a 409. Anything else is ours, not theirs.
      const status = (err as { status?: number })?.status;
      setError(
        status === 409
          ? 'That username is already taken. Try another.'
          : 'Could not save that just now. Please try again.'
      );
      if (status !== 409) showToast({ title: 'Could not save your details', variant: 'error' });
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.root, styles.centred]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Set up your account</Text>
        <Text style={styles.subtitle}>
          You can change any of this later in your profile.
        </Text>

        <Text style={styles.label}>Username</Text>
        <Text style={styles.hint}>This is the name other people see on your comments.</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={(v) => { setUsername(v); setError(null); }}
          placeholder="Your username"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={30}
          returnKeyType="next"
        />

        <Text style={styles.label}>Initials</Text>
        <Text style={styles.hint}>
          Shown in your avatar. Leave blank to use your username.
        </Text>
        <TextInput
          style={styles.input}
          value={initials}
          onChangeText={setInitials}
          placeholder="e.g. JT"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={5}
          returnKeyType="done"
        />

        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={styles.label}>Private account</Text>
            <Text style={styles.hint}>
              People need your approval to follow you, and only approved
              followers see your comments.
            </Text>
          </View>
          <Switch
            value={isPrivate}
            onValueChange={setIsPrivate}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor={colors.background}
          />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[styles.primaryBtn, saving && styles.btnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color={colors.onColor} />
          ) : (
            <>
              <Text style={styles.primaryBtnText}>Save and continue</Text>
              <Ionicons name="arrow-forward" size={18} color={colors.onColor} style={{ marginLeft: 8 }} />
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={finish} disabled={saving} style={styles.skipRow}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  centred: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 24 },
  title: { fontSize: 26, fontFamily: 'Inter_700Bold', color: c.text },
  subtitle: {
    fontSize: 14, fontFamily: 'Inter_400Regular', color: c.textMuted,
    marginTop: 6, marginBottom: 28,
  },
  label: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: c.text, marginBottom: 2 },
  hint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textFaint, marginBottom: 8 },
  input: {
    backgroundColor: c.surfaceSubtle,
    borderWidth: 1, borderColor: c.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontFamily: 'Inter_400Regular', color: c.text,
    marginBottom: 22,
    ...webInputReset,
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 16, marginBottom: 8,
  },
  toggleText: { flex: 1 },
  error: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: c.destructiveStrong,
    marginTop: 8, marginBottom: 4,
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.primary, borderRadius: 12,
    paddingVertical: 16, marginTop: 24,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: c.onColor },
  skipRow: { alignItems: 'center', paddingVertical: 16 },
  skipText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: c.textMuted },
});
