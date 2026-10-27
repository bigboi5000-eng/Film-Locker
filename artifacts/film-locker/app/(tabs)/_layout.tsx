import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { runStorageSelfTest, storageSelfTestResult } from '@/lib/clerkTokenCache';
import { useAuth } from '@clerk/expo';
import { useUser } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import {
  setAuthTokenGetter,
  setAuthStateDescriber,
  useGetConversations,
  getGetConversationsQueryKey,
  useGetFollows,
  getGetFollowsQueryKey,
  useSyncUser,
} from '@workspace/api-client-react';

// The badge red is the same in both themes: it has to shout, and a muted
// one would stop doing its job on a dark tab bar.
const BADGE_RED = '#EF4444';

/** People icon with an optional unread count badge */
function CommunityTabIcon({
  color,
  focused,
  unreadCount,
}: {
  color: string;
  focused: boolean;
  unreadCount: number;
}) {
  const colors = useColors();
  return (
    <View style={{ width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={focused ? 'people' : 'people-outline'} size={22} color={color} />
      {unreadCount > 0 && (
        <View
          style={{
            position: 'absolute',
            top: -3,
            right: -6,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: BADGE_RED,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 3,
            borderWidth: 1.5,
            borderColor: colors.background,
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
  const insets = useSafeAreaInsets();
  const colors = useColors();

  // Wire Clerk bearer token into the generated API client for every request
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    // And what the app believes about itself, sent only when a request
    // ends up with no token. From the server a tokenless request looks
    // like an ordinary signed-out visitor; this is what distinguishes
    // that from the app insisting it is signed in while Clerk hands back
    // nothing — which is the state we are actually chasing.
    setAuthStateDescriber(
      () =>
        `isSignedIn=${isSignedIn} isLoaded=${isLoaded} hasUser=${Boolean(user)} ` +
        `store=${storageSelfTestResult()}`,
    );
  }, [getToken, isSignedIn, isLoaded, user]);

  // Once per launch, and the answer rides along with the next request
  // that fails to find a token.
  useEffect(() => {
    void runStorageSelfTest();
  }, []);

  // JIT-provision the user row in the DB on every sign-in
  useEffect(() => {
    if (!user) return;
    const email = user.primaryEmailAddress?.emailAddress;
    if (!email) return;
    syncUser({
      // avatarUrl is deliberately always null. Clerk's `imageUrl` is whatever
      // the social provider supplied, and for an account with no photo Google
      // returns a generated image of the first letter of the person's name —
      // so syncing it put a "J" on other people's screens for someone who had
      // chosen their own initials, and never uploaded a picture at all.
      //
      // Sent as an explicit null rather than omitted so that rows already
      // carrying a provider image are cleared the next time the app opens.
      // The column stays for a future in-app avatar upload; nothing writes it
      // for now, so every avatar falls through to the initials.
      data: { email, avatarUrl: null, username: user.username ?? null },
    }).catch(() => {
      // Non-fatal — best-effort
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // What the Inbox badge counts.
  //
  // Unread recommendations plus follow requests waiting on an answer. The
  // badge used to be unread recommendations alone, so a request to connect
  // arrived with no indication anywhere on the tab bar — the only way to
  // discover one was to open the tab and switch to Film Pals, which nobody
  // does without a reason to.
  const { data: conversationData } = useGetConversations({
    query: {
      queryKey: getGetConversationsQueryKey(),
      enabled: Boolean(isSignedIn),
      refetchInterval: 30_000,
    },
  });
  const { data: followsData } = useGetFollows({
    query: {
      queryKey: getGetFollowsQueryKey(),
      enabled: Boolean(isSignedIn),
      refetchInterval: 60_000,
    },
  });
  const unreadCount =
    (conversationData?.unreadCount ?? 0) + (followsData?.incomingRequests?.length ?? 0);

  if (!isLoaded) return null;

  // No redirect for signed-out visitors, deliberately.
  //
  // This used to send anyone without an account straight to the sign-in
  // screen, which is what App Store guideline 5.1.1(v) rejected the app
  // over: an app may not require registration to reach features that are
  // not account based, and browsing films is not account based.
  //
  // The discovery endpoints never needed auth — trending, new releases,
  // search, film details, community scores and comments are all public — so
  // the wall was this line alone. The account-based tabs explain themselves
  // instead, and the actions that genuinely need an account ask at the point
  // of use.

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          // Extra bottom space for the home-indicator/gesture-nav safe
          // area, so the icons/labels sit above it instead of the
          // indicator overlapping the tab bar's own bottom padding.
          height: 60 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
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
      {/*
        Named Films, routed as "watchlist", and holding both lists behind a
        toggle. The route keeps its name because the share handler and the
        film modal both navigate to it by path, and a tab's label is not its
        address.
      */}
      <Tabs.Screen
        name="watchlist"
        options={{
          title: 'Films',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'albums' : 'albums-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'newspaper' : 'newspaper-outline'} size={22} color={color} />
          ),
        }}
      />
      {/*
        Named Community, routed as "notifications".

        The label changed when the tab became three things — a feed, the
        messages and the people — but the route did not, because push
        notifications already in flight carry "/(tabs)/notifications" as
        their destination and anything already installed deep-links to it.
        Renaming the file would break both for no gain.
      */}
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Community',
          tabBarIcon: ({ color, focused }) => (
            <CommunityTabIcon color={color} focused={focused} unreadCount={unreadCount} />
          ),
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
        }}
      />
    </Tabs>
  );
}
