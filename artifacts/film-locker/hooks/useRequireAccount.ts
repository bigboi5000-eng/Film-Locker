import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';

/**
 * "You need an account for that", asked once and answered the same way
 * everywhere.
 *
 * Browsing, searching and reading are deliberately open — guideline
 * 5.1.1(v) and plain good sense both want that — so the moment somebody
 * tries to keep something is the first point an account is needed. Hitting
 * them with a 401 and "Could not add this film. Please try again." is the
 * worst possible answer: it reads as a fault in the app, and it does not
 * mention the one thing that would fix it.
 *
 * Returns a guard. Call it before the work; if it returns false it has
 * already explained itself and offered the way out, so just stop.
 *
 *     if (!requireAccount('save films to your watchlist')) return;
 *
 * `action` finishes the sentence "Create a free account to ___", so phrase
 * it as something the person wants, not as the operation that failed.
 */
export function useRequireAccount(): (action: string) => boolean {
  const { isSignedIn } = useAuth();
  const router = useRouter();

  return useCallback(
    (action: string) => {
      if (isSignedIn) return true;
      Alert.alert(
        'Account needed',
        `Create a free account to ${action}. Searching and browsing films works without one.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Sign in', onPress: () => router.push('/(auth)/sign-in') },
          { text: 'Create account', onPress: () => router.push('/(auth)/sign-up') },
        ]
      );
      return false;
    },
    [isSignedIn, router]
  );
}
