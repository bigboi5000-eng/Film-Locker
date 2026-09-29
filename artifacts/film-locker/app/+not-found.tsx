import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

export default function NotFoundScreen() {
  const colors = useColors();

  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          This screen doesn&apos;t exist.
        </Text>

        {/*
         * Routed through sign-in rather than "/" — the auth layout redirects
         * a signed-in user straight to (tabs) anyway, so this is a safe
         * landing spot regardless of auth state and can't loop back into
         * whatever broken route got us here.
         */}
        <Link href="/(auth)/sign-in" asChild>
          <Text
            style={[styles.button, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
          >
            Go to home screen
          </Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  button: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    overflow: 'hidden',
  },
});
