import { useAuth } from '@clerk/expo';
import { Redirect, Stack } from 'expo-router';

export default function AuthLayout() {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) return null;

  // Already signed in — send to the main app
  if (isSignedIn) return <Redirect href="/(tabs)/" />;

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
  );
}
