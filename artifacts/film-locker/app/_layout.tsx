import React, { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClerkProvider, ClerkLoaded, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
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
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { setBaseUrl, setAuthTokenGetter } from '@workspace/api-client-react';
import { registerForPushNotificationsAsync } from '@/lib/pushNotifications';
import { customFetch } from '@workspace/api-client-react';

// Configure API base URL for Expo (runs outside web proxy)
if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

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
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="discover/[section]" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="inbox/[userId]" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="people" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="profile" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="blocked-users" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="playlist/[id]" options={{ headerShown: false, animation: 'slide_from_right' }} />
    </Stack>
  );
}

export default function RootLayout() {
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
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ClerkLoaded>
        <SafeAreaProvider>
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
        </SafeAreaProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}
