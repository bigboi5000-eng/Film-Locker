import React, { useCallback, useEffect, useState } from 'react';
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
} from 'react-native';
import { useSignIn, useSSO, useAuth } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { Link, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { webInputReset } from '@/lib/webInputReset';

WebBrowser.maybeCompleteAuthSession();

function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);
}

export default function SignInScreen() {
  useWarmUpBrowser();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { signIn, errors, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null);

  if (isSignedIn) return null;

  const handleSignIn = async () => {
    const { error } = await signIn.password({ emailAddress: email, password });
    if (error) return;

    if (signIn.status === 'complete') {
      await signIn.finalize({
        navigate: ({ session }) => {
          if (session?.currentTask) return;
          router.replace('/(tabs)');
        },
      });
    } else if (signIn.status === 'needs_client_trust') {
      await signIn.mfa.sendEmailCode();
    }
  };

  const handleMfaVerify = async () => {
    await signIn.mfa.verifyEmailCode({ code: mfaCode });
    if (signIn.status === 'complete') {
      await signIn.finalize({
        navigate: ({ session }) => {
          if (session?.currentTask) return;
          router.replace('/(tabs)');
        },
      });
    }
  };

  const handleOAuth = useCallback(async (strategy: 'oauth_google' | 'oauth_apple') => {
    setOauthLoading(strategy === 'oauth_google' ? 'google' : 'apple');
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy,
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      if (createdSessionId) {
        await setActive!({
          session: createdSessionId,
          navigate: async ({ session }) => {
            if (session?.currentTask) return;
            router.replace('/(tabs)');
          },
        });
      }
    } catch (err) {
      console.error('OAuth error:', err);
    } finally {
      setOauthLoading(null);
    }
  }, [startSSOFlow, router]);

  // MFA verification step
  if (signIn.status === 'needs_client_trust') {
    return (
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inner}>
          <Text style={styles.logo}>FILM LOCKER</Text>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>We sent a verification code to {email}</Text>
          <TextInput
            style={styles.input}
            value={mfaCode}
            onChangeText={setMfaCode}
            placeholder="Verification code"
            placeholderTextColor="#9CA3AF"
            keyboardType="number-pad"
            autoFocus
          />
          {errors?.fields?.code && (
            <Text style={styles.error}>{errors.fields.code.message}</Text>
          )}
          <TouchableOpacity
            style={[styles.primaryBtn, (!mfaCode || fetchStatus === 'fetching') && styles.btnDisabled]}
            onPress={handleMfaVerify}
            disabled={!mfaCode || fetchStatus === 'fetching'}
            activeOpacity={0.85}
          >
            {fetchStatus === 'fetching'
              ? <ActivityIndicator color="#FFF" />
              : <Text style={styles.primaryBtnText}>Verify</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => signIn.mfa.sendEmailCode()} style={styles.linkRow}>
            <Text style={styles.linkText}>Resend code</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => signIn.reset()} style={styles.linkRow}>
            <Text style={styles.mutedText}>Start over</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.inner}>
          {/* Branding */}
          <View style={styles.brandRow}>
            <View style={styles.brandDot} />
            <Text style={styles.logo}>FILM LOCKER</Text>
          </View>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>

          {/* Email */}
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            returnKeyType="next"
          />
          {errors?.fields?.identifier && (
            <Text style={styles.error}>{errors.fields.identifier.message}</Text>
          )}

          {/* Password */}
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              placeholderTextColor="#9CA3AF"
              secureTextEntry={!showPassword}
              autoComplete="password"
              returnKeyType="done"
              onSubmitEditing={handleSignIn}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword((v) => !v)}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>
          {errors?.fields?.password && (
            <Text style={styles.error}>{errors.fields.password.message}</Text>
          )}

          {/* Sign in button */}
          <TouchableOpacity
            style={[styles.primaryBtn, (!email || !password || fetchStatus === 'fetching') && styles.btnDisabled]}
            onPress={handleSignIn}
            disabled={!email || !password || fetchStatus === 'fetching'}
            activeOpacity={0.85}
          >
            {fetchStatus === 'fetching'
              ? <ActivityIndicator color="#FFF" />
              : <Text style={styles.primaryBtnText}>Sign In</Text>}
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Google */}
          <TouchableOpacity
            style={[styles.oauthBtn, oauthLoading === 'google' && styles.btnDisabled]}
            onPress={() => handleOAuth('oauth_google')}
            disabled={oauthLoading !== null}
            activeOpacity={0.85}
          >
            {oauthLoading === 'google'
              ? <ActivityIndicator color="#374151" size="small" />
              : <>
                  <Ionicons name="logo-google" size={18} color="#374151" />
                  <Text style={styles.oauthBtnText}>Continue with Google</Text>
                </>}
          </TouchableOpacity>

          {/* Apple — iOS only */}
          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={[styles.oauthBtn, styles.appleBtn, oauthLoading === 'apple' && styles.btnDisabled]}
              onPress={() => handleOAuth('oauth_apple')}
              disabled={oauthLoading !== null}
              activeOpacity={0.85}
            >
              {oauthLoading === 'apple'
                ? <ActivityIndicator color="#FFF" size="small" />
                : <>
                    <Ionicons name="logo-apple" size={18} color="#FFFFFF" />
                    <Text style={[styles.oauthBtnText, styles.appleBtnText]}>Continue with Apple</Text>
                  </>}
            </TouchableOpacity>
          )}

          {/* Sign up link */}
          <View style={styles.footerRow}>
            <Text style={styles.mutedText}>New to Film Locker? </Text>
            <Link href="/(auth)/sign-up">
              <Text style={styles.linkText}>Create an account</Text>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flexGrow: 1, justifyContent: 'center' },
  inner: { paddingHorizontal: 24, paddingVertical: 48 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 32 },
  brandDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#0066FF' },
  logo: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: 3, color: '#111827' },
  title: { fontSize: 26, fontFamily: 'Inter_700Bold', color: '#111827', marginBottom: 6 },
  subtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#6B7280', marginBottom: 28 },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#374151', marginBottom: 6 },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#111827',
    marginBottom: 14,
    ...webInputReset,
  },
  passwordRow: { position: 'relative' },
  passwordInput: { paddingRight: 46 },
  eyeBtn: { position: 'absolute', right: 14, top: 12 },
  error: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#EF4444', marginTop: -10, marginBottom: 10 },
  primaryBtn: {
    backgroundColor: '#0066FF',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  dividerText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },
  oauthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingVertical: 13,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  oauthBtnText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: '#374151' },
  appleBtn: { backgroundColor: '#111827', borderColor: '#111827' },
  appleBtnText: { color: '#FFFFFF' },
  footerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  linkText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#0066FF' },
  linkRow: { alignItems: 'center', paddingVertical: 8 },
  mutedText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#6B7280' },
});
