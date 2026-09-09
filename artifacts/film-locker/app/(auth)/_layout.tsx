import { useAuth } from '@clerk/expo';
import { Stack } from 'expo-router';

export default function AuthLayout() {
  const { isLoaded } = useAuth();

  if (!isLoaded) return null;

  // Deliberately no redirect for signed-in users.
  //
  // This used to send them to the welcome gate, on the theory that anything
  // signed-in reaching these screens should be routed onwards. That is
  // actively harmful during sign-out: if Clerk's isSignedIn has not yet
  // flipped when we navigate here, the redirect fires, the gate forwards to
  // the tabs, and the user is thrown straight back into the app they were
  // trying to leave.
  //
  // Nothing needs it. The sign-in and sign-up screens navigate explicitly on
  // success — sign-up and OAuth to /welcome, password sign-in to the tabs —
  // so this was a second, competing opinion about where to go, and the one
  // with the worse failure mode.

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
  );
}
