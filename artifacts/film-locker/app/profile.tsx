import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Platform, Switch, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { useAuth, useUser } from '@clerk/expo';
import { useThemeControl, type ThemeChoice } from '@/components/ThemeProvider';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMe,
  useUpdateMe,
  useSubmitFeedback,
  useDeleteMe,
  getGetMeQueryKey,
} from '@workspace/api-client-react';
import { confirmDestructive } from '@/lib/confirm';
import Constants from 'expo-constants';
import { PRIVACY_URL, TERMS_URL, CONTACT_EMAIL } from '@/lib/legalLinks';
import { useToast } from '@/components/ToastProvider';
import { webInputReset } from '@/lib/webInputReset';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

function errorMessage(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as any).message === 'string') {
    return (err as any).message;
  }
  return undefined;
}


function Row({
  icon, label, value, danger, onPress,
}: {
  icon: string;
  label: string;
  value?: string;
  danger?: boolean;
  onPress?: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
    >
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
        <Ionicons name={icon as any} size={18} color={danger ? colors.destructive : colors.textMuted} />
      </View>
      <View style={styles.rowContent}>
        <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]}>{label}</Text>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      </View>
      {onPress && (
        <Ionicons name="chevron-forward" size={16} color={colors.iconFaint} />
      )}
    </TouchableOpacity>
  );
}

/**
 * Light, Dark or Automatic.
 *
 * Three segments rather than a switch, because a switch cannot express
 * "follow the phone" — and that is the default, so it needs saying rather
 * than being the unlabelled off position of something else.
 */
function ThemePicker() {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { theme, systemScheme, setTheme } = useThemeControl();

  const options: Array<{ value: ThemeChoice; label: string; icon: string }> = [
    { value: 'light', label: 'Light', icon: 'sunny-outline' },
    { value: 'dark', label: 'Dark', icon: 'moon-outline' },
    { value: 'automatic', label: 'Automatic', icon: 'phone-portrait-outline' },
  ];

  return (
    <View>
      <View style={styles.themeRow}>
        {options.map((option) => {
          const active = theme === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              style={[styles.themeOption, active && styles.themeOptionActive]}
              onPress={() => setTheme(option.value)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={option.icon as any}
                size={17}
                color={active ? colors.primary : colors.textFaint}
              />
              <Text style={[styles.themeOptionText, active && styles.themeOptionTextActive]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {theme === 'automatic' ? (
        <Text style={styles.themeHint}>
          Following your phone, which is set to {systemScheme}.
        </Text>
      ) : null}
    </View>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isLoaded, isSignedIn, signOut, userId: myClerkId } = useAuth();
  const { user: clerkUser } = useUser();
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useGetMe({
    query: { queryKey: getGetMeQueryKey() },
  });

  const { mutateAsync: updateMe, isPending: saving } = useUpdateMe();
  const { showToast } = useToast();

  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [editingInitials, setEditingInitials] = useState(false);
  const [initialsInput, setInitialsInput] = useState('');

  // firstName deliberately absent from this chain. It is only ever populated
  // by a social provider, the privacy policy says the app does not display it,
  // and using it here meant someone who signed in with Google saw a name they
  // never gave us.
  const displayName = profile?.username ?? clerkUser?.username ?? 'You';
  const email = profile?.email ?? clerkUser?.primaryEmailAddress?.emailAddress ?? '';
  // Initials come from what the user chose, falling back to their username —
  // never from displayName, which could still resolve to the literal 'You'.
  const initials = (profile?.displayInitials || profile?.username || clerkUser?.username || '')
    .slice(0, 5)
    .toUpperCase();

  const handleStartEditUsername = useCallback(() => {
    setUsernameInput(profile?.username ?? '');
    setEditingUsername(true);
  }, [profile?.username]);

  const handleSaveUsername = useCallback(async () => {
    const trimmed = usernameInput.trim();
    if (!trimmed || trimmed.length < 2) {
      showToast({ title: 'Too short', subtitle: 'Username must be at least 2 characters.', variant: 'error' });
      return;
    }
    try {
      await updateMe({ data: { username: trimmed } });
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      setEditingUsername(false);
    } catch (err) {
      showToast({ title: 'Could not update username', subtitle: errorMessage(err) ?? 'Try a different one.', variant: 'error' });
    }
  }, [usernameInput, updateMe, queryClient, showToast]);

  const [togglingPrivacy, setTogglingPrivacy] = useState(false);

  const handleTogglePrivacy = useCallback(async (next: boolean) => {
    setTogglingPrivacy(true);
    try {
      await updateMe({ data: { isPrivate: next } });
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    } catch (err) {
      showToast({ title: 'Could not update account visibility', subtitle: errorMessage(err), variant: 'error' });
    } finally {
      setTogglingPrivacy(false);
    }
  }, [updateMe, queryClient, showToast]);

  const handleStartEditInitials = useCallback(() => {
    setInitialsInput(profile?.displayInitials ?? '');
    setEditingInitials(true);
  }, [profile?.displayInitials]);

  const handleSaveInitials = useCallback(async () => {
    const trimmed = initialsInput.trim().toUpperCase().slice(0, 3);
    try {
      await updateMe({ data: { displayInitials: trimmed.length > 0 ? trimmed : null } });
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      setEditingInitials(false);
    } catch (err) {
      showToast({ title: 'Could not update display initials', subtitle: errorMessage(err), variant: 'error' });
    }
  }, [initialsInput, updateMe, queryClient, showToast]);

  const [feedbackText, setFeedbackText] = useState('');
  const { mutateAsync: submitFeedback, isPending: sendingFeedback } = useSubmitFeedback();

  const handleSendFeedback = useCallback(async () => {
    const trimmed = feedbackText.trim();
    if (!trimmed) return;
    try {
      await submitFeedback({ data: { message: trimmed } });
      setFeedbackText('');
      showToast({ title: 'Thanks for the feedback!', subtitle: 'We read every one.', variant: 'success' });
    } catch (err) {
      showToast({ title: 'Could not send feedback', subtitle: errorMessage(err), variant: 'error' });
    }
  }, [feedbackText, submitFeedback, showToast]);

  const handleSignOut = useCallback(() => {
    // Navigate unconditionally, and do not wait on isSignedIn to tell us the
    // session has gone. In practice it does not flip here: signing out clears
    // the stored session — a restart lands you on sign-in — but the hook keeps
    // reporting signed-in, so the guard below never fires and the screen just
    // sits there. Whatever the cause, the user asked to leave, so leave.
    //
    // The failure is swallowed for the same reason: if revoking the session
    // server-side fails, the local session is still gone and stranding
    // someone on their account page is not a useful way to say so.
    confirmDestructive('Are you sure you want to sign out?', 'Sign out', async () => {
      try {
        await signOut();
      } catch {
        // fall through to the navigation below
      }
      router.replace('/(auth)/sign-in');
    });
  }, [signOut, router]);

  const { mutateAsync: deleteMe } = useDeleteMe();

  const handleDeleteAccount = useCallback(() => {
    confirmDestructive(
      'This permanently deletes your Film Locker account, watchlist, and all social data. This cannot be undone.',
      'Delete',
      async () => {
        try {
          // One call does all of it. The server deletes every row and then the
          // Clerk identity itself, using the secret key — deleting from here
          // instead failed with "needs to supply an active session", because
          // Clerk puts user deletion behind reverification and the native
          // prompt for that does not exist yet.
          await deleteMe();
          // The account is gone, so the local session is now meaningless.
          // Clear it rather than leaving a token for a user that no longer
          // exists, then leave regardless of whether that succeeds.
          try {
            await signOut();
          } catch {
            // the account is already deleted; nothing useful to report
          }
          router.replace('/(auth)/sign-in');
        } catch (err) {
          showToast({ title: 'Could not delete your account', subtitle: errorMessage(err) ?? 'Please contact support.', variant: 'error' });
        }
      }
    );
  }, [deleteMe, signOut, router, showToast]);

  // Leave the moment the session goes, however it goes — signing out, or a
  // session expiring while the screen is open. Deliberately below every hook
  // so the early return cannot change hook order.
  if (isLoaded && !isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        {/* Avatar + name */}
        <View style={styles.hero}>
          <View style={styles.avatarWrap}>
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          </View>
          <Text style={styles.heroName}>{displayName}</Text>
          <Text style={styles.heroEmail}>{email}</Text>
        </View>

        {/*
          The public side of the account, which this screen is not. Everything
          below here is settings; the page other people actually open lives at
          /user/<id> and had no route into it from anywhere the owner would
          look — so the only way to see your own profile was to find yourself
          in somebody else's followers list.
        */}
        {myClerkId ? (
          <View style={styles.card}>
            <Row
              icon="person-circle-outline"
              label="View your profile"
              value="See what other people see"
              onPress={() => router.push(`/user/${myClerkId}`)}
            />
          </View>
        ) : null}

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
                placeholderTextColor={colors.textFaint}
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
                  <ActivityIndicator size="small" color={colors.background} />
                ) : (
                  <Text style={styles.saveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setEditingUsername(false)}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={18} color={colors.textMuted} />
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
                onChangeText={(t) => setInitialsInput(t.slice(0, 3))}
                placeholder="e.g. JPT"
                placeholderTextColor={colors.textFaint}
                autoFocus
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={3}
              />
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleSaveInitials}
                disabled={saving}
                activeOpacity={0.8}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.background} />
                ) : (
                  <Text style={styles.saveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setEditingInitials(false)}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={18} color={colors.textMuted} />
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
              <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
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
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Switch
                value={Boolean(profile?.isPrivate)}
                onValueChange={handleTogglePrivacy}
                trackColor={{ true: colors.primary }}
              />
            )}
          </View>
          <Row
            icon="ban-outline"
            label="Blocked users"
            onPress={() => router.push('/blocked-users')}
          />
        </View>

        {/* Appearance */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Appearance</Text>
          <ThemePicker />
        </View>

        {/* Legal */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Legal</Text>
          <Row icon="document-text-outline" label="Privacy Policy" onPress={() => Linking.openURL(PRIVACY_URL)} />
          <Row icon="document-text-outline" label="Terms of Service" onPress={() => Linking.openURL(TERMS_URL)} />
        </View>

        {/* About — TMDB attribution is required by TMDB's terms of use
            wherever their data is displayed, which is essentially every
            screen in this app, so it lives here rather than being repeated.
            The version line is here so that a bug report can say which
            build it came from. */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>About</Text>
          <Row
            icon="mail-outline"
            label="Contact us"
            value={CONTACT_EMAIL}
            onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`)}
          />
          <Row
            icon="information-circle-outline"
            label="Version"
            value={Constants.expoConfig?.version ?? '—'}
          />
          <Text style={styles.attribution}>
            This product uses the TMDB API but is not endorsed or certified by TMDB.
            Film data and posters courtesy of{' '}
            <Text
              style={styles.attributionLink}
              onPress={() => Linking.openURL('https://www.themoviedb.org/')}
            >
              The Movie Database
            </Text>
            .
          </Text>
        </View>

        {/* Feedback */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Feedback</Text>
          <View style={styles.feedbackBody}>
            <Text style={styles.feedbackHint}>
              Spot a bug, or have an idea for the app? Let us know below.
            </Text>
            <TextInput
              style={styles.feedbackInput}
              value={feedbackText}
              onChangeText={(t) => setFeedbackText(t.slice(0, 2000))}
              placeholder="What's working, what's not, what you'd like to see…"
              placeholderTextColor={colors.textFaint}
              multiline
              maxLength={2000}
              textAlignVertical="top"
            />
            <View style={styles.feedbackFooter}>
              <Text style={styles.feedbackCharCount}>{feedbackText.length}/2000</Text>
              <TouchableOpacity
                style={[styles.saveBtn, (!feedbackText.trim() || sendingFeedback) && styles.saveBtnDisabled]}
                onPress={handleSendFeedback}
                disabled={!feedbackText.trim() || sendingFeedback}
                activeOpacity={0.8}
              >
                {sendingFeedback ? (
                  <ActivityIndicator size="small" color={colors.background} />
                ) : (
                  <Text style={styles.saveBtnText}>Send</Text>
                )}
              </TouchableOpacity>
            </View>
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

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.surfaceSubtle },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: c.background, borderBottomWidth: 1, borderBottomColor: c.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: c.text },

  hero: { alignItems: 'center', paddingVertical: 32, backgroundColor: c.background, marginBottom: 20 },
  avatarWrap: { marginBottom: 12 },
  avatar: { width: 80, height: 80, borderRadius: 40 },
  avatarFallback: { backgroundColor: c.avatarBg, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 28, fontFamily: 'Inter_700Bold', color: c.avatarFg },
  heroName: { fontSize: 20, fontFamily: 'Inter_700Bold', color: c.text, marginBottom: 4 },
  heroEmail: { fontSize: 14, fontFamily: 'Inter_400Regular', color: c.textFaint },

  card: {
    backgroundColor: c.background, marginHorizontal: 16, marginBottom: 16,
    borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: c.border,
  },
  cardTitle: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold',
    color: c.textFaint, letterSpacing: 0.6, textTransform: 'uppercase',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4,
  },

  attribution: {
    fontSize: 11, fontFamily: 'Inter_400Regular', color: c.textFaint,
    lineHeight: 16, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14,
    borderTopWidth: 1, borderTopColor: c.surfaceAlt,
  },
  attributionLink: { color: c.textMuted, fontFamily: 'Inter_500Medium' },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
    borderTopWidth: 1, borderTopColor: c.surfaceAlt,
  },
  privacyRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: c.surfaceSubtle, alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  rowIconDanger: { backgroundColor: c.destructiveSoft },
  rowContent: { flex: 1 },
  themeRow: { flexDirection: 'row', gap: 8, paddingTop: 4 },
  themeOption: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceSubtle,
  },
  themeOptionActive: { borderColor: c.primary, backgroundColor: c.primarySoft },
  themeOptionText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: c.textFaint },
  themeOptionTextActive: { color: c.primary },
  themeHint: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: c.textFaint,
    marginTop: 10,
    lineHeight: 17,
  },

  rowLabel: { fontSize: 15, fontFamily: 'Inter_500Medium', color: c.text },
  rowLabelDanger: { color: c.destructive },
  rowValue: { fontSize: 13, fontFamily: 'Inter_400Regular', color: c.textFaint, marginTop: 1 },

  editRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: c.surfaceAlt,
  },
  textInput: {
    flex: 1, height: 40, paddingHorizontal: 12,
    backgroundColor: c.surfaceSubtle, borderRadius: 8,
    borderWidth: 1, borderColor: c.border,
    fontSize: 15, fontFamily: 'Inter_400Regular', color: c.text,
    ...webInputReset,
  },
  saveBtn: {
    backgroundColor: c.primary, paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 8, minWidth: 56, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: c.background },
  cancelBtn: { padding: 8 },

  feedbackBody: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16 },
  feedbackHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: c.textMuted, marginBottom: 10, lineHeight: 18 },
  feedbackInput: {
    minHeight: 90, maxHeight: 160, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: c.surfaceSubtle, borderRadius: 8,
    borderWidth: 1, borderColor: c.border,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: c.text,
    ...webInputReset,
  },
  feedbackFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 8,
  },
  feedbackCharCount: { fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textFaint },
});
