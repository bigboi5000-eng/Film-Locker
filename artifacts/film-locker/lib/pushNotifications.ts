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
 * Request permission and return the Expo push token string, or null when
 * unavailable.  Never throws — push is a best-effort enhancement.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    // Push tokens require a physical device (simulators don't have APNs creds).
    if (!Constants.isDevice) {
      return null;
    }

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
      return null;
    }

    const token = await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig?.extra?.eas?.projectId,
    });

    return token.data;
  } catch {
    // Broad catch: push is optional, never crash startup.
    return null;
  }
}
