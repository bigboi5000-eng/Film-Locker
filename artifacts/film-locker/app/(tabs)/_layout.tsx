import React from 'react';
import { Tabs } from 'expo-router';

/**
 * Film Locker is a single-screen app — no visible tab bar.
 */
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Locker' }} />
    </Tabs>
  );
}
