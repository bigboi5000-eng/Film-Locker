/**
 * The feed, as its own tab.
 *
 * It lived inside Community alongside the messages and the people, which
 * put the one thing you open the app to browse two taps behind a tab named
 * after something else. Messages are a thing you go to when the badge says
 * so; the feed is a thing you go to when you have a minute.
 *
 * Signed in, it is what the people you follow have been watching. Signed
 * out it is not a door — see GuestFeed.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SocialFeedView } from '@/components/SocialFeed';
import { PlaylistCard } from '@/components/PlaylistCard';
import { LoadError } from '@/components/LoadError';
import {
  useSearchPublicPlaylists,
  getSearchPublicPlaylistsQueryKey,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { Palette } from '@/constants/colors';

function FeedScreenInner() {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Feed</Text>
      </View>
      <SocialFeedView />
    </View>
  );
}

/**
 * The feed for somebody with no account.
 *
 * This tab used to be a full-screen "Create an account" panel, and that is
 * the likeliest reading of the third 5.1.1(v) rejection: a reviewer tapping
 * along the tab bar met a registration wall on half of it, and a tab headed
 * "see what everyone is watching" is film information by any reasonable
 * reading, whatever we meant by it.
 *
 * A PERSONAL feed genuinely is account based — it is assembled from the
 * people you follow, and a guest follows nobody, so there is nothing to
 * assemble. Public playlists are not account based at all: they are other
 * people's lists, served by an endpoint that has never required auth, and
 * they answer the same question the tab asks. So that is what a guest gets,
 * with the account prompt as a banner over real content rather than a door
 * in front of it.
 *
 * Everything here leads somewhere that also works signed out: a playlist
 * page, and the film sheet inside it.
 */
function GuestFeed() {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const colors = useColors();
  const router = useRouter();

  // No parameters: every public playlist, which is the browse case. The
  // endpoint takes q/tmdbId/userId and all three are optional.
  const { data, isLoading, isError, error, refetch, isRefetching } =
    useSearchPublicPlaylists(undefined, {
      query: { queryKey: getSearchPublicPlaylistsQueryKey(undefined) },
    });
  const playlists = data?.playlists ?? [];

  const banner = (
    <TouchableOpacity
      style={styles.guestBanner}
      onPress={() => router.push('/(auth)/sign-up')}
      activeOpacity={0.85}
    >
      <Ionicons name="people-outline" size={18} color={colors.primary} />
      <Text style={styles.guestBannerText}>
        Browse these lists freely. Create a free account to follow people and get
        a feed of what they are watching.
      </Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Feed</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
      ) : isError ? (
        <View style={{ paddingTop: 16 }}>
          <LoadError
            title="Could not load public lists"
            error={error}
            onRetry={refetch}
            retrying={isRefetching}
          />
        </View>
      ) : playlists.length === 0 ? (
        // Nothing public to show yet. Still not a wall: it says browsing is
        // free and goes there, rather than offering only a sign-up button.
        <View style={styles.emptyWrap}>
          {banner}
          <Text style={styles.emptyText}>
            Nobody has shared a public list yet.
          </Text>
          <TouchableOpacity
            style={styles.browseBtn}
            onPress={() => router.replace('/(tabs)')}
            activeOpacity={0.85}
          >
            <Text style={styles.browseBtnText}>Browse films</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={playlists}
          numColumns={2}
          keyExtractor={(item) => `pub-${item.id}`}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={{
            paddingTop: 16,
            paddingBottom: insets.bottom + 24,
            gap: 16,
          }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={<View style={styles.bannerWrap}>{banner}</View>}
          renderItem={({ item }) => (
            <PlaylistCard
              playlist={item}
              onPress={() =>
                router.push({ pathname: '/playlist/[id]', params: { id: String(item.id) } })
              }
            />
          )}
        />
      )}
    </View>
  );
}

export default function FeedScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <GuestFeed />;
  return <FeedScreenInner />;
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: c.text, letterSpacing: 0.5 },
  columnWrapper: { paddingHorizontal: 16, justifyContent: 'space-between' },
  bannerWrap: { paddingHorizontal: 16 },
  guestBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: c.surfaceSubtle,
    borderRadius: 10,
  },
  guestBannerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: c.textMuted,
    lineHeight: 18,
  },
  emptyWrap: { paddingHorizontal: 16, paddingTop: 16, alignItems: 'stretch' },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: c.textMuted,
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 20,
  },
  browseBtn: {
    backgroundColor: c.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  browseBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: c.onColor },
});
