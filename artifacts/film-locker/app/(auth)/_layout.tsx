import { Stack } from 'expo-router';

export default function AuthLayout() {
  // No gates of any kind here, deliberately.
  //
  // This layout had two, and both caused the bug they were meant to prevent.
  //
  // A redirect for signed-in users sent them to the welcome gate, which
  // during sign-out threw them straight back into the app they were leaving —
  // Clerk's isSignedIn does not reliably flip, so the redirect fired against
  // a session that had in fact already gone.
  //
  // Then `if (!isLoaded) return null` was left as the last gate, and became
  // the blank screen people landed on after signing out instead. A route
  // whose entire purpose is to show a sign-in form should never render
  // nothing: the form does not need Clerk to be loaded to be drawn, and
  // useSignIn handles its own readiness when someone actually submits it.
  //
  // Both screens navigate explicitly on success, so nothing here needs to
  // have an opinion about where anyone goes.
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
  );
}
