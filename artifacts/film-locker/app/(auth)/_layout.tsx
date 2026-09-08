import { useAuth } from '@clerk/expo';
import { Redirect, Stack } from 'expo-router';

export default function AuthLayout() {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) return null;

  // Already signed in — hand off to the welcome gate rather than the tabs.
  // It shows the post-sign-up celebration if this account has not seen it and
  // forwards to the tabs otherwise, which keeps that decision in one place.
  // Routing here also removes a race: signing up flips isSignedIn, and this
  // redirect would otherwise fire against the screen's own navigation.
  if (isSignedIn) return <Redirect href="/welcome" />;

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
  );
}
