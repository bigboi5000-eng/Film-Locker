import React, { useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClerkProvider, ClerkLoaded, useAuth } from '@clerk/expo';
import { chunkedTokenCache } from '@/lib/clerkTokenCache';
import { ShareIntentProvider } from 'expo-share-intent';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ShareIntentHandler } from '@/components/ShareIntentHandler';
import { ToastProvider } from '@/components/ToastProvider';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider } from '@/components/ThemeProvider';
import { useColors, useIsDark } from '@/hooks/useColors';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { setBaseUrl, setAuthTokenGetter, ApiError } from '@workspace/api-client-react';
import { registerForPushNotificationsAsync } from '@/lib/pushNotifications';
import { customFetch } from '@workspace/api-client-react';

// Configure API base URL for Expo (runs outside web proxy)
if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

/**
 * Retry the things worth retrying, and nothing else.
 *
 * The default retries everything three times, which is wrong in both
 * directions here: a 404 or a 403 is a settled answer and retrying it only
 * delays showing the user what happened, while a stalled connection — now
 * that requests time out rather than hanging — is exactly the case where
 * trying again usually works, because the second attempt opens a fresh
 * socket.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (failureCount >= 2) return false;
        // A reply from the server is an answer, not a failure to reach it.
        // 408 and 429 are the two that explicitly invite another go.
        if (error instanceof ApiError) {
          // Not 429. The window is fifteen minutes, so trying again in two
          // seconds cannot succeed and only spends more of the budget that
          // ran out — which is how a brief overshoot turns into a long one.
          return error.status === 408;
        }
        return true;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      /**
       * Half a minute before anything is considered worth fetching again.
       *
       * Needed now that coming back to the app refetches on focus: without
       * it every query is stale the instant it lands, so every glance at
       * the app would refire every request on screen. Invalidation after a
       * mutation ignores this, so rating a film still updates immediately.
       */
      staleTime: 30_000,
    },
  },
});

/**
 * Tell React Query when the app is in front of you.
 *
 * It refetches stale queries on focus, but "focus" means a browser window
 * event, which React Native does not have — so without this the feature is
 * simply inert on a phone, and nothing refetches when you return to the
 * app however long it has been in your pocket.
 *
 * That is the other half of the spinning: a connection does not survive
 * being backgrounded, and with no focus signal React Query had no reason
 * to go and get anything, so the screen stayed exactly as stale as it was
 * when you left. Now returning to the app refreshes what is on it, which
 * is also what recovers a failed request without you doing anything.
 */
function useRefetchOnForeground(): void {
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);
}

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

// The production build profile ships a placeholder until a real Clerk
// production key is pasted in (see LAUNCH.md). Without this check that
// mistake surfaces as an opaque Clerk failure on the sign-in screen of an
// already-submitted build; this way it stops the app immediately, at the
// point where the cause is obvious.
if (!publishableKey?.startsWith('pk_')) {
  throw new Error(
    'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is missing or is still the placeholder. ' +
      'Set a real Clerk key in eas.json for this build profile — see LAUNCH.md.'
  );
}

/**
 * Registers push notification permissions after sign-in and uploads the token
 * to the server.  Also handles deep-link navigation when a notification tap
 * brings the app to the foreground.
 */
function PushNotificationManager() {
  const { isSignedIn, getToken } = useAuth();
  const router = useRouter();
  const notificationResponseListener = useRef<Notifications.EventSubscription | null>(null);
  const tokenUploaded = useRef(false);

  // Register for push notifications once the user is signed in
  useEffect(() => {
    if (!isSignedIn || tokenUploaded.current) return;

    (async () => {
      const token = await registerForPushNotificationsAsync();
      if (!token) return;

      try {
        // Wire auth getter so customFetch can attach the bearer token
        setAuthTokenGetter(() => getToken());

        await customFetch('/api/users/push-token', {
          method: 'PUT',
          body: JSON.stringify({ expoPushToken: token }),
          headers: { 'Content-Type': 'application/json' },
        });
        tokenUploaded.current = true;
      } catch {
        // Non-fatal — in-app inbox is the fallback
      }
    })();
  }, [isSignedIn, getToken]);

  // Deep-link to Inbox when user taps a push notification.
  // Handles both:
  //   - Live taps (app in foreground/background) via the response listener
  //   - Cold-start taps (app launched from killed state) via getLastNotificationResponseAsync
  useEffect(() => {
    // Push notifications are native-only; skip on web
    if (Platform.OS === 'web') return;

    // Cold-start: check if the app was opened by tapping a notification
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as Record<string, unknown>;
      const screen = data?.screen as string | undefined;
      if (screen) {
        router.push(screen as Parameters<typeof router.push>[0]);
      } else {
        router.push('/(tabs)/notifications');
      }
    });

    // Live listener: handles taps while app is running (foreground/background)
    notificationResponseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as Record<string, unknown>;
        const screen = data?.screen as string | undefined;
        if (screen) {
          router.push(screen as Parameters<typeof router.push>[0]);
        } else {
          router.push('/(tabs)/notifications');
        }
      });

    return () => {
      notificationResponseListener.current?.remove();
    };
  }, [router]);

  return null;
}

function RootLayoutNav() {
  const colors = useColors();
  return (
    // contentStyle, not just the screens' own backgrounds: the card behind a
    // push transition is the navigator's, and it is white by default — which
    // shows as a flash of white at the edge of every slide on a dark theme.
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      {/* Fades in over the sign-up screen, and cannot be swiped away — the
          only way out is the button, which is what records it as seen. */}
      <Stack.Screen
        name="welcome"
        options={{ headerShown: false, animation: 'fade', gestureEnabled: false }}
      />
      {/* Follows the welcome tour. Also not swipeable: there is a Skip
          button, and a half-dismissed setup screen would leave people
          unsure whether anything had been saved. */}
      <Stack.Screen
        name="account-setup"
        options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: false }}
      />
      <Stack.Screen name="discover/[section]" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="inbox/[userId]" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="people" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="profile" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="blocked-users" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="playlist/[id]" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="playlists" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="user/[clerkId]" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="person/[personId]" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="connections/[userId]" options={{ headerShown: false, animation: 'slide_from_right' }} />
    </Stack>
  );
}

/**
 * The status bar, which has to be inside the provider to read the theme.
 *
 * Not "auto": that follows the device, which is wrong the moment somebody
 * picks Light on a phone set to dark — the icons would go white on a white
 * header. This follows the theme actually in force.
 */
function ThemedChrome() {
  const isDark = useIsDark();
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
}

export default function RootLayout() {
  useRefetchOnForeground();

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ShareIntentProvider>
      {/* Not @clerk/expo's own tokenCache — see lib/clerkTokenCache.ts. That
          one hands a token straight to SecureStore, which refuses anything
          over 2048 bytes, and Clerk's JWTs go past that. The write failed
          with nothing to catch it, so the session survived exactly as long
          as the in-memory token did. */}
      {/* No __experimental_resourceCache here, deliberately.
          Clerk's docs say it makes a failed token refresh fall back to the
          cached token instead of signing the user out, which is exactly
          the failure this app has. Enabling it made things sharply worse:
          instead of lasting a minute, the session was gone immediately.
          It is marked experimental and it restores a persisted client, so
          a stale or half-written one is read as an invalid session at
          start-up. Left off until the refresh failure itself is
          understood — a mitigation that costs the whole session is not a
          mitigation. */}
      <ClerkProvider publishableKey={publishableKey} tokenCache={chunkedTokenCache}>
        <ClerkLoaded>
          <SafeAreaProvider>
            <ThemeProvider>
              <ThemedChrome />
              <ErrorBoundary>
                <QueryClientProvider client={queryClient}>
                  <GestureHandlerRootView style={{ flex: 1 }}>
                    <ToastProvider>
                      <KeyboardProvider>
                        <PushNotificationManager />
                        <RootLayoutNav />
                        <ShareIntentHandler />
                      </KeyboardProvider>
                    </ToastProvider>
                  </GestureHandlerRootView>
                </QueryClientProvider>
              </ErrorBoundary>
            </ThemeProvider>
          </SafeAreaProvider>
        </ClerkLoaded>
      </ClerkProvider>
    </ShareIntentProvider>
  );
}
