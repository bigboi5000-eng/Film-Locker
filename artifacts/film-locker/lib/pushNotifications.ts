/**
 * Expo push notification registration helpers.
 *
 * Call `registerForPushNotificationsAsync()` once when the user is signed in.
 * It requests permission, retrieves the Expo push token, and returns it (or
 * null when the user declines or we're running in an environment where push is
 * unavailable, e.g. a simulator without credentials).
 */
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Configure how incoming notifications behave while the app is in the
 * foreground (show banner + play sound).
 *
 * Note: expo-notifications >=0.32 uses shouldShowBanner / shouldShowList
 * instead of the deprecated shouldShowAlert.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Why there is no push token, when there isn't one.
 *
 * 'denied' is a choice and nothing is wrong. The rest are faults, and the
 * settings screen shows them rather than leaving a switch that is on while
 * nothing arrives — which is what Android looked like with no Firebase
 * credentials: permission granted, channel created, and getExpoPushToken
 * throwing into a bare catch that returned null.
 */
export type PushUnavailableReason = 'denied' | 'no-project-id' | 'error' | null;

let lastReason: PushUnavailableReason = null;
let lastError: string | null = null;

/** What stopped push working last time registration ran. */
export function pushStatus(): { reason: PushUnavailableReason; detail: string | null } {
  return { reason: lastReason, detail: lastError };
}

/**
 * Request permission and return the Expo push token string, or null when
 * unavailable.  Never throws — push is a best-effort enhancement.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  lastReason = null;
  lastError = null;
  try {
    // Simulators have no APNs credentials, so getExpoPushTokenAsync throws
    // there. That is caught below and returns null, which is why there is no
    // physical-device guard here: `Constants.isDevice` does not exist in
    // expo-constants, and reading it silently disabled push on every device.

    // Android needs a notification channel set up first.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    // PermissionResponse from expo-modules-core has a `granted` convenience bool.
    let permissionGranted = existing.granted;

    if (!permissionGranted) {
      const result = await Notifications.requestPermissionsAsync();
      permissionGranted = result.granted;
    }

    if (!permissionGranted) {
      // User denied — graceful degradation, in-app inbox still works.
      lastReason = 'denied';
      return null;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      lastReason = 'no-project-id';
      return null;
    }

    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch (err) {
    // Still never throws — push is optional and must not break startup —
    // but the reason is kept now instead of vanishing. On Android with no
    // FCM credentials this is where it failed, silently, for as long as
    // the app has existed.
    lastReason = 'error';
    lastError = err instanceof Error ? err.message : String(err);
    return null;
  }
}
