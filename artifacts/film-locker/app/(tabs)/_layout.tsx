import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { useUser } from '@clerk/expo';
import { setAuthTokenGetter, useGetNotifications, getGetNotificationsQueryKey, useSyncUser } from '@workspace/api-client-react';

const BLUE = '#0066FF';
const INACTIVE = '#9CA3AF';

/** Bell icon with an optional unread count badge */
function NotificationTabIcon({
  color,
  focused,
  unreadCount,
}: {
  color: string;
  focused: boolean;
  unreadCount: number;
}) {
  return (
    <View style={{ width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={focused ? 'notifications' : 'notifications-outline'} size={22} color={color} />
      {unreadCount > 0 && (
        <View
          style={{
            position: 'absolute',
            top: -3,
            right: -6,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: '#EF4444',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 3,
            borderWidth: 1.5,
            borderColor: '#FFFFFF',
          }}
        >
        </View>
      )}
    </View>
  );
}

export default function TabLayout() {
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const { user } = useUser();
  const { mutateAsync: syncUser } = useSyncUser();

  // Wire Clerk bearer token into the generated API client for every request
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
  }, [getToken]);

  // JIT-provision the user row in the DB on every sign-in
  useEffect(() => {
    if (!user) return;
    const email = user.primaryEmailAddress?.emailAddress;
    if (!email) return;
    syncUser({
      data: { email, avatarUrl: user.imageUrl ?? null, username: user.username ?? null },
    }).catch(() => {
      // Non-fatal — best-effort
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Fetch unread notification count for the badge
  const { data: notifData } = useGetNotifications({
    query: { queryKey: getGetNotificationsQueryKey(), enabled: Boolean(isSignedIn), refetchInterval: 30_000 },
  });
  const unreadCount = notifData?.unreadCount ?? 0;

  if (!isLoaded) return null;

  // Not signed in → send to auth screens
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: BLUE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#E5E7EB',
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: 'Inter_500Medium',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="watchlist"
        options={{
          title: 'Watchlist',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'bookmark' : 'bookmark-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="watched"
        options={{
          title: 'Watched',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'checkmark-circle' : 'checkmark-circle-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color, focused }) => (
            <NotificationTabIcon color={color} focused={focused} unreadCount={unreadCount} />
          ),
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
        }}
      />
    </Tabs>
  );
}
