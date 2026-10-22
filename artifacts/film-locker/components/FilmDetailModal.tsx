import React, { useCallback, useState, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
  TextInput,
  KeyboardAvoidingView,
  Keyboard,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';
import {
  useGetMovieDetails,
  usePatchWatched,
  usePatchRating,
  useAddMovie,
  useListMovies,
  useGetFilmCommunityScore,
  useSetFilmCommunityRating,
  useDeleteFilmCommunityRating,
  useGetFilmComments,
  usePostFilmComment,
  useDeleteFilmComment,
  useGetNotificationUsers,
  getGetNotificationUsersQueryKey,
  useSendNotification,
  useBlockUser,
  useSubmitReport,
  getGetFilmCommunityScoreQueryKey,
  getGetFilmCommentsQueryKey,
  getGetFollowsQueryKey,
  getListMoviesQueryKey,
  type Movie,
  useGetSimilarMovies,
  getGetSimilarMoviesQueryKey,
  type TmdbMovieCard,
  type WatchProvider,
  type FilmComment,
  type NotificationUser,
} from '@workspace/api-client-react';
import { confirmDestructive } from '@/lib/confirm';
import { CONTACT_EMAIL } from '@/lib/legalLinks';
import { webInputReset } from '@/lib/webInputReset';
import { getDeviceRegion } from '@/lib/region';
import { useToast } from '@/components/ToastProvider';
import { AddToPlaylistSheet } from '@/components/AddToPlaylistSheet';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import { StarRating } from '@/components/StarRating';
import type { Palette } from '@/constants/colors';

const { width: W, height: H } = Dimensions.get('window');
const POSTER_HEIGHT = H * 0.45;
const COMMENT_MAX = 280;

interface FilmDetailModalProps {
  visible: boolean;
  onClose: () => void;
  /** TMDB ID — always required; used to fetch full detail data */
  tmdbId: number;
  /** Basic card data shown immediately while full details load */
  title: string;
  posterUrl: string;
  releaseYear: string;
  overview: string;
  /** If this movie is saved in the locker, pass the full DB record */
  savedMovie?: Movie;
  /**
   * Where this film came from, when the caller knows it from something
   * other than the viewer's own locker row — a playlist item, say.
   *
   * A film can be in a playlist without being in the locker at all, and
   * then savedMovie is undefined and there is nothing to read a source
   * from. This is how a shared list keeps its link back to the post.
   */
  sourceUrl?: string | null;
}


// ── Watch Provider pill ────────────────────────────────────────────────────────

const PROVIDER_TYPE_LABEL: Record<string, string> = {
  flatrate: 'Included',
  rent: 'Rent / Buy',
  buy: 'Rent / Buy',
};

// theme-ignore: a provider badge's green and orange are the badge's own,
// theme-ignore: and this is module scope, where no palette hook can reach.
const PROVIDER_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  flatrate: { bg: '#D1FAE5', text: '#065F46' }, // theme-ignore green — subscription
  rent:     { bg: '#FFF0DC', text: '#FF8C00' }, // theme-ignore orange — rent/buy
  buy:      { bg: '#FFF0DC', text: '#FF8C00' }, // theme-ignore orange — rent/buy
};

/**
 * What to call the thing a film was saved from.
 *
 * The wording is the platform's own, because "See the original post" is
 * wrong for half of them — a YouTube link is a video, and a Google link is
 * not a post at all but the search that found the film. Anything
 * unrecognised gets the neutral phrasing rather than a guess.
 */
function describeSource(rawUrl: string): { label: string; icon: keyof typeof Ionicons.glyphMap } {
  let host = '';
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return { label: 'See where this came from', icon: 'link-outline' };
  }

  if (host.endsWith('instagram.com')) return { label: 'See the original post', icon: 'logo-instagram' };
  if (host.endsWith('tiktok.com')) return { label: 'See the original post', icon: 'musical-notes-outline' };
  if (host.endsWith('facebook.com') || host.endsWith('fb.watch'))
    return { label: 'See the original post', icon: 'logo-facebook' };
  if (host.endsWith('threads.net')) return { label: 'See the original post', icon: 'at-outline' };
  if (host.endsWith('x.com') || host.endsWith('twitter.com'))
    return { label: 'See the original post', icon: 'logo-twitter' };
  if (host.endsWith('reddit.com')) return { label: 'See the original post', icon: 'logo-reddit' };
  if (host.endsWith('youtube.com') || host.endsWith('youtu.be'))
    return { label: 'Watch the original video', icon: 'logo-youtube' };
  if (host.endsWith('google.com') || host.endsWith('share.google') || host.endsWith('bing.com'))
    return { label: 'See the search this came from', icon: 'search-outline' };
  return { label: 'See where this came from', icon: 'link-outline' };
}

async function openProviderLink(provider: WatchProvider, movieTitle: string) {
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(
    `watch ${movieTitle} on ${provider.provider_name}`
  )}`;

  if (provider.link) {
    try {
      await Linking.openURL(provider.link);
      return;
    } catch {
      // JustWatch link failed — fall through to Google search
    }
  }

  Linking.openURL(googleUrl).catch(() => {
    Alert.alert('Unable to open link', 'Could not open the streaming service.');
  });
}

function ProviderPill({
  provider,
  movieTitle,
}: {
  provider: WatchProvider;
  movieTitle: string;
}) {
  const providerStyles = useThemedStyles(makeProviderStyles);
  const typeKey = provider.type ?? 'flatrate';
  const label = PROVIDER_TYPE_LABEL[typeKey] ?? typeKey;
  const badgeTone = PROVIDER_TYPE_COLORS[typeKey] ?? PROVIDER_TYPE_COLORS.flatrate;

  return (
    <TouchableOpacity
      style={providerStyles.pill}
      onPress={() => openProviderLink(provider, movieTitle)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Watch on ${provider.provider_name} — ${label}`}
    >
      {provider.logo_url ? (
        <Image
          source={{ uri: provider.logo_url }}
          style={providerStyles.logo}
          contentFit="cover"
        />
      ) : (
        <View style={[providerStyles.logo, providerStyles.logoFallback]}>
          <Text style={providerStyles.logoFallbackText}>
            {provider.provider_name[0]}
          </Text>
        </View>
      )}
      <Text style={providerStyles.name} numberOfLines={1}>
        {provider.provider_name}
      </Text>
      <View style={[providerStyles.badge, { backgroundColor: badgeTone.bg }]}>
        <Text style={[providerStyles.badgeText, { color: badgeTone.text }]}>
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const makeProviderStyles = (c: Palette) => StyleSheet.create({
  pill: { alignItems: 'center', marginRight: 14, width: 64 },
  logo: { width: 48, height: 48, borderRadius: 10, marginBottom: 4 },
  logoFallback: { backgroundColor: c.border, alignItems: 'center', justifyContent: 'center' },
  logoFallbackText: { fontSize: 18, fontFamily: 'Inter_700Bold', color: c.textMuted },
  name: { fontSize: 10, fontFamily: 'Inter_400Regular', color: c.textMuted, textAlign: 'center', marginBottom: 3 },
  badge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  badgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },
});

// ── Genre tag ──────────────────────────────────────────────────────────────────

function GenreTag({ label }: { label: string }) {
  const tagStyles = useThemedStyles(makeTagStyles);
  return (
    <View style={tagStyles.tag}>
      <Text style={tagStyles.text}>{label}</Text>
    </View>
  );
}

const makeTagStyles = (c: Palette) => StyleSheet.create({
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: c.primarySoft,
    marginRight: 6,
    marginBottom: 6,
  },
  text: { fontSize: 12, fontFamily: 'Inter_500Medium', color: c.primary },
});

// ── Community Stars (read-only display) ───────────────────────────────────────

function CommunityStars({ value }: { value: number | null | undefined }) {
  // Rounded to the nearest half now there is one. An average of 3.7 used to
  // round to four whole stars, which overstated it by a bigger margin than
  // the half it can now show.
  return <StarRating value={value ? Math.round(value * 2) / 2 : null} size={18} gap={2} />;
}

// ── Comment row ────────────────────────────────────────────────────────────────

function CommentRow({
  comment,
  onDelete,
  onReport,
}: {
  comment: FilmComment;
  onDelete: (id: number) => void;
  onReport: (comment: FilmComment) => void;
}) {
  const colors = useColors();
  const commentStyles = useThemedStyles(makeCommentStyles);
  const router = useRouter();
  const initials = (comment.username ?? comment.userId.slice(0, 2)).slice(0, 2).toUpperCase();
  const timeAgo = formatRelative(new Date(comment.createdAt));
  const goToProfile = () => router.push(`/user/${comment.userId}`);

  return (
    <View style={commentStyles.row}>
      {/* Avatar */}
      <TouchableOpacity onPress={goToProfile} activeOpacity={0.7}>
        {comment.avatarUrl ? (
          <Image
            source={{ uri: comment.avatarUrl }}
            style={commentStyles.avatar}
            contentFit="cover"
          />
        ) : (
          <View style={[commentStyles.avatar, commentStyles.avatarFallback]}>
            <Text style={commentStyles.avatarText}>{initials}</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Body */}
      <View style={{ flex: 1 }}>
        <View style={commentStyles.metaRow}>
          <TouchableOpacity onPress={goToProfile} activeOpacity={0.7}>
            <Text style={commentStyles.username}>
              {comment.username ?? 'Anonymous'}
            </Text>
          </TouchableOpacity>
          {comment.rating != null && (
            <View style={commentStyles.ratingRow}>
              <StarRating value={comment.rating} size={11} gap={1} />
            </View>
          )}
          <Text style={commentStyles.time}>{timeAgo}</Text>
          {comment.isOwn ? (
            <TouchableOpacity
              onPress={() => onDelete(comment.id)}
              hitSlop={10}
              style={commentStyles.deleteBtn}
            >
              <Ionicons name="trash-outline" size={14} color={colors.textFaint} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => onReport(comment)}
              hitSlop={10}
              style={commentStyles.deleteBtn}
            >
              <Ionicons name="flag-outline" size={14} color={colors.textFaint} />
            </TouchableOpacity>
          )}
        </View>
        <Text style={commentStyles.body}>{comment.body}</Text>
      </View>
    </View>
  );
}

// ── Report sheet — lets you report a comment/user with a reason, or block
// the user outright. No in-app moderation queue yet; a report is emailed to
// hello@film-locker.com best-effort and always saved server-side.
//
// The sheet states the review commitment and gives the contact address as a
// fallback, because the email delivery is best-effort — sendEmail never
// throws — and someone reporting abuse should not be left with no way to
// follow up if the notification silently fails to arrive. ──

function ReportSheet({
  visible,
  targetUsername,
  onSubmit,
  onBlock,
  onClose,
  submitting,
}: {
  visible: boolean;
  targetUsername: string;
  onSubmit: (reason: string) => void;
  onBlock: () => void;
  onClose: () => void;
  submitting: boolean;
}) {
  const colors = useColors();
  const reportStyles = useThemedStyles(makeReportStyles);
  const [reason, setReason] = useState('');

  const handleClose = useCallback(() => {
    setReason('');
    onClose();
  }, [onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={reportStyles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity style={reportStyles.backdrop} onPress={handleClose} activeOpacity={1} />
        <View style={reportStyles.sheet}>
          <View style={reportStyles.handle} />
          <Text style={reportStyles.title}>Report {targetUsername}</Text>
          <TextInput
            style={reportStyles.input}
            value={reason}
            onChangeText={(t) => setReason(t.slice(0, 1000))}
            placeholder="What's wrong with this? (required)"
            placeholderTextColor={colors.textFaint}
            multiline
            maxLength={1000}
            textAlignVertical="top"
          />
          <Text style={reportStyles.assurance}>
            We review every report within 24 hours. You can also email{' '}
            <Text
              style={reportStyles.assuranceLink}
              onPress={() =>
                Linking.openURL(
                  `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Film Locker report: ${targetUsername}`)}`
                )
              }
            >
              {CONTACT_EMAIL}
            </Text>
            .
          </Text>

          <TouchableOpacity
            style={[reportStyles.submitBtn, (!reason.trim() || submitting) && reportStyles.btnDisabled]}
            onPress={() => onSubmit(reason.trim())}
            disabled={!reason.trim() || submitting}
            activeOpacity={0.85}
          >
            {submitting ? <ActivityIndicator color={colors.onColor} /> : <Text style={reportStyles.submitBtnText}>Submit Report</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={reportStyles.blockBtn} onPress={onBlock} activeOpacity={0.85}>
            <Text style={reportStyles.blockBtnText}>Block {targetUsername}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleClose} style={reportStyles.cancelBtn} activeOpacity={0.7}>
            <Text style={reportStyles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeReportStyles = (c: Palette) => StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: c.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 17, fontFamily: 'Inter_700Bold', color: c.text, marginBottom: 12 },
  input: {
    minHeight: 80, maxHeight: 140, borderWidth: 1, borderColor: c.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: 'Inter_400Regular',
    color: c.text, backgroundColor: c.surfaceSubtle, marginBottom: 12,
    ...webInputReset,
  },
  assurance: {
    fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textMuted,
    lineHeight: 17, marginBottom: 12,
  },
  assuranceLink: { color: c.primary, fontFamily: 'Inter_600SemiBold' },
  submitBtn: {
    backgroundColor: c.primary, borderRadius: 10, paddingVertical: 13,
    alignItems: 'center', marginBottom: 10,
  },
  btnDisabled: { opacity: 0.5 },
  submitBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: c.onColor },
  blockBtn: {
    borderRadius: 10, paddingVertical: 13, alignItems: 'center',
    borderWidth: 1, borderColor: '#FCA5A5', marginBottom: 10,
  },
  blockBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: c.destructiveStrong },
  cancelBtn: { alignItems: 'center', paddingVertical: 8 },
  cancelBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: c.textMuted },
});

function formatRelative(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function formatVoteCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

/**
 * Runtime in minutes → "2h 22m". Films under an hour keep the plain minutes
 * form ("48m") rather than reading "0h 48m", and an exact number of hours
 * drops the minutes ("2h"). Returns null for anything TMDB doesn't have a
 * runtime for, so the caller can skip the row entirely instead of showing
 * a blank or "0m".
 */
function formatRuntime(minutes: number | null | undefined): string | null {
  if (typeof minutes !== 'number' || minutes <= 0) return null;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

const makeCommentStyles = (c: Palette) => StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  avatar: { width: 36, height: 36, borderRadius: 18, flexShrink: 0 },
  avatarFallback: { backgroundColor: c.avatarBg, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: c.avatarFg },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  username: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.text },
  ratingRow: { flexDirection: 'row', gap: 1 },
  time: { fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textFaint },
  deleteBtn: { marginLeft: 'auto' },
  body: { fontSize: 14, fontFamily: 'Inter_400Regular', color: c.textStrong, lineHeight: 20 },
});

// ── Community section ─────────────────────────────────────────────────────────

function CommunitySection({
  onStarInteraction,
  tmdbId,
  isLoggedIn,
  onRatingChanged,
}: {
  tmdbId: number;
  isLoggedIn: boolean;
  /**
   * Fired after a community rating is set, with the value the server also
   * wrote to the viewer's own rating of the film.
   *
   * The two ratings live in different components, and the private one is
   * displayed from optimistic state that outlives a refetch — so without
   * telling the parent, the server's copy lands in the database and the
   * stars above it never move. Which is exactly how this looked broken.
   */
  onRatingChanged?: (rating: number | null) => void;
  /** Passed straight to the stars, so the sheet can stop scrolling. */
  onStarInteraction?: (active: boolean) => void;
}) {
  const colors = useColors();
  const communityStyles = useThemedStyles(makeCommunityStyles);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [commentText, setCommentText] = useState('');
  const [page, setPage] = useState(1);
  // Accumulated comments across all loaded pages
  const [allComments, setAllComments] = useState<FilmComment[]>([]);
  const [reportTarget, setReportTarget] = useState<FilmComment | null>(null);

  const { data: score, isLoading: scoreLoading } = useGetFilmCommunityScore(tmdbId);
  const { data: commentsData, isLoading: commentsLoading } = useGetFilmComments(tmdbId, { page });
  // Declared here rather than beside the stars it feeds, because
  // handleCommunityRating closes over it below: a dependency array is
  // evaluated during render, so a later `const` would be in its temporal
  // dead zone and throw.
  const userRating = score?.userRating ?? null;

  const { mutateAsync: submitRating, isPending: ratingPending } = useSetFilmCommunityRating();
  const { mutateAsync: deleteRating, isPending: ratingDeleting } = useDeleteFilmCommunityRating();
  const { mutateAsync: postComment, isPending: commentPending } = usePostFilmComment();
  const { mutateAsync: deleteComment } = useDeleteFilmComment();
  const { mutateAsync: submitReport, isPending: reportPending } = useSubmitReport();
  const { mutateAsync: blockUser } = useBlockUser();

  // Append newly fetched page into accumulated list (dedup by id)
  React.useEffect(() => {
    if (!commentsData?.comments) return;
    setAllComments((prev) => {
      const existingIds = new Set(prev.map((c) => c.id));
      const fresh = commentsData.comments.filter((c) => !existingIds.has(c.id));
      return page === 1 ? commentsData.comments : [...prev, ...fresh];
    });
  }, [commentsData, page]);

  const invalidateScore = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: getGetFilmCommunityScoreQueryKey(tmdbId) });
  }, [queryClient, tmdbId]);

  const resetComments = useCallback(async () => {
    setPage(1);
    setAllComments([]);
    await queryClient.invalidateQueries({ queryKey: getGetFilmCommentsQueryKey(tmdbId) });
  }, [queryClient, tmdbId]);

  const handleCommunityRating = useCallback(
    async (n: number, viaDrag: boolean) => {
      if (!isLoggedIn) {
        Alert.alert('Sign in required', 'Please sign in to rate this film.');
        return;
      }
      if (Platform.OS !== 'web') Haptics.selectionAsync();

      // Tapping the star you already gave clears it. SLIDING onto it does
      // not — landing on your own score mid-drag is how you confirm it, not
      // how you delete it, which is the rule the private rating has always
      // followed and this one did not.
      //
      // The difference is the whole of "halves don't work here": slide
      // towards three and a half, overshoot onto the four you already had,
      // and the rating vanished. The control was reporting which gesture it
      // was all along; this was the one caller not listening.
      const clearing = !viaDrag && userRating === n;

      try {
        if (clearing) {
          await deleteRating({ tmdbId });
          await invalidateScore();
          // Deliberately not clearing the private rating — see the server
          // route. Withdrawing a public rating says nothing about what you
          // thought of the film, and may well undo one you set privately
          // first.
          return;
        }

        await submitRating({ tmdbId, data: { rating: n } });
        await invalidateScore();
        // The server copies this onto the viewer's own rating of the film;
        // tell the parent so the stars for it move too.
        onRatingChanged?.(n);
      } catch (err) {
        // The server's own words, as the private rating already reports
        // them. A half-star reaching a deployment whose column has not been
        // widened yet says exactly that, and "Could not save your rating"
        // sends the reader nowhere.
        const detail = err instanceof Error ? err.message : '';
        Alert.alert(
          clearing ? 'Could not remove your rating' : 'Could not save your rating',
          detail || 'Please try again.'
        );
      }
    },
    [isLoggedIn, submitRating, deleteRating, tmdbId, invalidateScore, userRating, onRatingChanged]
  );

  const handlePostComment = useCallback(async () => {
    const text = commentText.trim();
    if (!text) return;
    try {
      await postComment({ tmdbId, data: { body: text } });
      setCommentText('');
      Keyboard.dismiss();
      await resetComments();
    } catch {
      Alert.alert('Error', 'Could not post your comment.');
    }
  }, [commentText, postComment, tmdbId, resetComments]);

  const handleDeleteComment = useCallback(
    async (id: number) => {
      confirmDestructive('Remove this comment?', 'Delete', async () => {
        try {
          await deleteComment({ tmdbId, id });
          await resetComments();
        } catch {
          Alert.alert('Error', 'Could not delete comment.');
        }
      });
    },
    [deleteComment, tmdbId, resetComments]
  );

  const handleSubmitReport = useCallback(
    async (reason: string) => {
      if (!reportTarget || !reason.trim()) return;
      try {
        await submitReport({
          data: { reportedUserId: reportTarget.userId, reason, commentId: reportTarget.id },
        });
        setReportTarget(null);
        showToast({ title: 'Report submitted', subtitle: "Thanks for flagging it — we'll take a look.", variant: 'success' });
      } catch {
        showToast({ title: 'Could not submit report', variant: 'error' });
      }
    },
    [reportTarget, submitReport, showToast]
  );

  const handleBlockFromReport = useCallback(() => {
    if (!reportTarget) return;
    const username = reportTarget.username ?? 'this user';
    confirmDestructive(
      `Block ${username}? They won't be able to follow, message, or see your comments, and you won't see theirs.`,
      'Block',
      async () => {
        try {
          await blockUser({ data: { blockedId: reportTarget.userId } });
          setReportTarget(null);
          await resetComments();
          await queryClient.invalidateQueries({ queryKey: getGetFollowsQueryKey() });
          showToast({ title: `Blocked ${username}`, variant: 'success' });
        } catch {
          showToast({ title: 'Could not block this user', variant: 'error' });
        }
      }
    );
  }, [reportTarget, blockUser, resetComments, queryClient, showToast]);

  const average = score?.average ?? null;
  const ratingCount = score?.count ?? 0;
  const comments = allComments;
  const hasMore = commentsData?.hasMore ?? false;

  return (
    <View style={communityStyles.container}>
      {/* Section header */}
      <View style={communityStyles.headerRow}>
        <Ionicons name="people-outline" size={16} color={colors.text} style={{ marginRight: 6 }} />
        <Text style={communityStyles.title}>COMMUNITY</Text>
      </View>

      {/* Aggregate score */}
      <View style={communityStyles.scoreRow}>
        {scoreLoading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <>
            <CommunityStars value={average} />
            <Text style={communityStyles.scoreText}>
              {average !== null ? average.toFixed(1) : '—'} / 5
            </Text>
            <Text style={communityStyles.ratingCount}>
              ({ratingCount} {ratingCount === 1 ? 'rating' : 'ratings'})
            </Text>
          </>
        )}
      </View>

      {/* User's community rating */}
      <View style={communityStyles.userRatingRow}>
        <Text style={communityStyles.userRatingLabel} numberOfLines={2}>
          Your community rating:
        </Text>
        <StarRating
          value={userRating}
          onChange={handleCommunityRating}
          onInteractionChange={onStarInteraction}
        />
        {(ratingPending || ratingDeleting) && (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 8 }} />
        )}
      </View>

      {/* Divider */}
      <View style={communityStyles.divider} />

      {/* Comment compose box */}
      {isLoggedIn ? (
        <View style={communityStyles.compose}>
          <TextInput
            style={communityStyles.input}
            placeholder="Share your thoughts… (280 chars)"
            placeholderTextColor={colors.textFaint}
            value={commentText}
            onChangeText={(t) => setCommentText(t.slice(0, COMMENT_MAX))}
            multiline
            maxLength={COMMENT_MAX}
            textAlignVertical="top"
          />
          <View style={communityStyles.composeFooter}>
            <Text style={communityStyles.charCount}>
              {commentText.length}/{COMMENT_MAX}
            </Text>
            <TouchableOpacity
              style={[
                communityStyles.postBtn,
                (!commentText.trim() || commentPending) && communityStyles.postBtnDisabled,
              ]}
              onPress={handlePostComment}
              disabled={!commentText.trim() || commentPending}
              activeOpacity={0.8}
            >
              {commentPending ? (
                <ActivityIndicator size="small" color={colors.onColor} />
              ) : (
                <Text style={communityStyles.postBtnText}>Post</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <Text style={communityStyles.signInHint}>
          Sign in to leave a rating or comment.
        </Text>
      )}

      {/* Disclaimer */}
      <Text style={communityStyles.disclaimer}>
        These are user opinions, not editorial reviews.
      </Text>

      {/* Comments list */}
      {commentsLoading ? (
        <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 12 }} />
      ) : comments.length === 0 ? (
        <Text style={communityStyles.emptyText}>
          No comments yet. Be the first to share your thoughts!
        </Text>
      ) : (
        <>
          {comments.map((c) => (
            <CommentRow key={c.id} comment={c} onDelete={handleDeleteComment} onReport={setReportTarget} />
          ))}
          {hasMore && (
            <TouchableOpacity
              style={communityStyles.loadMoreBtn}
              onPress={() => setPage((p) => p + 1)}
            >
              <Text style={communityStyles.loadMoreText}>Load more comments</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      <ReportSheet
        visible={reportTarget !== null}
        targetUsername={reportTarget?.username ?? 'this user'}
        onSubmit={handleSubmitReport}
        onBlock={handleBlockFromReport}
        onClose={() => setReportTarget(null)}
        submitting={reportPending}
      />
    </View>
  );
}

const makeCommunityStyles = (c: Palette) => StyleSheet.create({
  container: {
    marginTop: 4,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  title: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: c.text,
    letterSpacing: 0.5,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  scoreText: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: c.text,
  },
  ratingCount: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: c.textMuted,
  },
  userRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  userRatingLabel: {
    // Shrinks so the stars do not. See the note on StarRating's container:
    // squeezing that control breaks where its taps land.
    flexShrink: 1,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: c.textMuted,
  },
  divider: { height: 1, backgroundColor: c.surfaceAlt, marginBottom: 16 },
  compose: {
    backgroundColor: c.surfaceSubtle,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border,
    padding: 12,
    marginBottom: 10,
  },
  input: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: c.text,
    minHeight: 60,
    maxHeight: 120,
    ...webInputReset,
  },
  composeFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  charCount: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: c.textFaint,
  },
  postBtn: {
    backgroundColor: c.primary,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
    minWidth: 60,
    alignItems: 'center',
  },
  postBtnDisabled: { backgroundColor: c.primaryMid },
  postBtnText: {
    color: c.onColor,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  signInHint: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: c.textMuted,
    marginBottom: 10,
    fontStyle: 'italic',
  },
  disclaimer: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: c.textFaint,
    marginBottom: 16,
    fontStyle: 'italic',
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: c.textFaint,
    textAlign: 'center',
    marginVertical: 16,
  },
  loadMoreBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  loadMoreText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: c.primary,
  },
});

// ── Recommend sheet ───────────────────────────────────────────────────────────

function RecommendSheet({
  visible,
  onClose,
  tmdbId,
  filmTitle,
  posterUrl,
}: {
  visible: boolean;
  onClose: () => void;
  tmdbId: number;
  filmTitle: string;
  posterUrl: string;
}) {
  const colors = useColors();
  const rsStyles = useThemedStyles(makeRsStyles);
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useGetNotificationUsers({ query: { queryKey: getGetNotificationUsersQueryKey(), enabled: visible } });
  const { mutateAsync: sendNotification, isPending } = useSendNotification();
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  const users = data?.users ?? [];

  const handleSend = useCallback(
    async (user: NotificationUser) => {
      if (sentIds.has(user.clerkId)) return;
      if (Platform.OS !== 'web') Haptics.selectionAsync();
      try {
        await sendNotification({
          data: { toUserId: user.clerkId, tmdbId, filmTitle, posterUrl },
        });
        setSentIds((prev) => new Set(prev).add(user.clerkId));
      } catch {
        Alert.alert('Error', 'Could not send the recommendation. Please try again.');
      }
    },
    [sentIds, sendNotification, tmdbId, filmTitle, posterUrl]
  );

  const handleClose = useCallback(() => {
    setSentIds(new Set());
    onClose();
  }, [onClose]);

  const renderUser = useCallback(
    ({ item }: { item: NotificationUser }) => {
      const name = item.username ?? item.clerkId.slice(0, 8);
      const initials = name.slice(0, 2).toUpperCase();
      const sent = sentIds.has(item.clerkId);

      return (
        <View style={rsStyles.userRow}>
          {/* Avatar */}
          {item.avatarUrl ? (
            <Image
              source={{ uri: item.avatarUrl }}
              style={rsStyles.avatar}
              contentFit="cover"
            />
          ) : (
            <View style={[rsStyles.avatar, rsStyles.avatarFallback]}>
              <Text style={rsStyles.avatarText}>{initials}</Text>
            </View>
          )}
          <Text style={rsStyles.username} numberOfLines={1}>
            {name}
          </Text>
          <TouchableOpacity
            style={[rsStyles.sendBtn, sent && rsStyles.sendBtnSent]}
            onPress={() => handleSend(item)}
            disabled={sent || isPending}
            activeOpacity={0.8}
          >
            {sent ? (
              <Ionicons name="checkmark" size={15} color={colors.onColor} />
            ) : (
              <Text style={rsStyles.sendBtnText}>Send</Text>
            )}
          </TouchableOpacity>
        </View>
      );
    },
    [sentIds, isPending, handleSend]
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[rsStyles.root, { paddingTop: insets.top + 12 }]}>
        {/* Header */}
        <View style={rsStyles.header}>
          <Text style={rsStyles.title}>Recommend to…</Text>
          <TouchableOpacity onPress={handleClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Film pill */}
        <View style={rsStyles.filmPill}>
          <Image source={{ uri: posterUrl }} style={rsStyles.pillPoster} contentFit="cover" />
          <Text style={rsStyles.pillTitle} numberOfLines={2}>{filmTitle}</Text>
        </View>

        {isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : users.length === 0 ? (
          <View style={rsStyles.empty}>
            <Ionicons name="people-outline" size={48} color={colors.iconFaint} />
            <Text style={rsStyles.emptyText}>Follow someone first to recommend films to them.</Text>
          </View>
        ) : (
          <FlatList
            data={users}
            keyExtractor={(u) => u.clerkId}
            renderItem={renderUser}
            contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
            ItemSeparatorComponent={() => <View style={rsStyles.separator} />}
          />
        )}
      </View>
    </Modal>
  );
}

const makeRsStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: c.text },
  filmPill: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    padding: 12,
    backgroundColor: c.surfaceSubtle,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border,
    gap: 12,
  },
  pillPoster: { width: 40, height: 60, borderRadius: 6 },
  pillTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: c.text, flex: 1 },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, flexShrink: 0 },
  avatarFallback: { backgroundColor: c.avatarBg, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: c.avatarFg },
  username: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: c.text },
  sendBtn: {
    backgroundColor: c.primary,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnSent: { backgroundColor: '#10B981' },
  sendBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: c.onColor },
  separator: { height: 1, backgroundColor: c.surfaceAlt, marginLeft: 72 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: c.textFaint, textAlign: 'center', paddingHorizontal: 32 },
});

// ── Main component ─────────────────────────────────────────────────────────────

/**
 * Films worth watching next.
 *
 * Fetched only while the sheet is open, because the row sits well below the
 * fold and a list that nobody scrolls to is not worth a TMDB round trip on
 * every card tap.
 *
 * Tapping one swaps this sheet for that film's, rather than stacking sheets
 * on top of each other — three deep and there is no way back but to close
 * them one at a time.
 */
function SimilarFilms({
  tmdbId,
  visible,
  onPick,
}: {
  tmdbId: number;
  visible: boolean;
  onPick: (movie: TmdbMovieCard) => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { data, isLoading } = useGetSimilarMovies(tmdbId, {
    query: { queryKey: getGetSimilarMoviesQueryKey(tmdbId), enabled: visible },
  });

  const movies = data?.movies ?? [];
  if (!isLoading && movies.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>More like this</Text>
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {movies.map((m) => (
            <TouchableOpacity
              key={m.tmdbId}
              style={styles.similarCard}
              onPress={() => onPick(m)}
              activeOpacity={0.8}
            >
              <Image source={{ uri: m.posterUrl }} style={styles.similarPoster} contentFit="cover" />
              <Text style={styles.similarTitle} numberOfLines={2}>{m.title}</Text>
              <Text style={styles.similarYear}>{m.releaseYear}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

export function FilmDetailModal({
  visible,
  onClose,
  tmdbId: tmdbIdProp,
  title: titleProp,
  posterUrl: posterUrlProp,
  releaseYear: releaseYearProp,
  overview: overviewProp,
  savedMovie: savedMovieProp,
  sourceUrl: sourceUrlProp,
}: FilmDetailModalProps) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  /**
   * The film currently on screen, which starts as the one the parent asked
   * for and changes when someone taps through "More like this".
   *
   * Held here rather than pushed back up to the parent because every screen
   * that renders this modal would otherwise need to learn about swapping,
   * and held instead of stacking a second modal because three deep there is
   * no way back but to dismiss them one at a time.
   */
  const [swapped, setSwapped] = useState<TmdbMovieCard | null>(null);

  const tmdbId = swapped?.tmdbId ?? tmdbIdProp;
  const title = swapped?.title ?? titleProp;
  const posterUrl = swapped?.posterUrl ?? posterUrlProp;
  const releaseYear = swapped?.releaseYear ?? releaseYearProp;
  const overview = swapped?.overview ?? overviewProp;
  // A film arrived at through the similar row is not the one the parent
  // knows about, so it has no saved-movie record to carry over — its own
  // state is fetched like any other unsaved film.
  const { isSignedIn } = useAuth();
  const isLoggedIn = Boolean(isSignedIn);

  /**
   * This viewer's own row for this film, found rather than demanded.
   *
   * Five of the nine screens that open this sheet did not pass it — the
   * feed, a person's filmography, somebody's profile, a thread, the share
   * sheet — and savedMovie gates the whole owner's half of the screen. So a
   * film you had watched and rated opened from the feed showed no stars, no
   * "mark watched", and no link back to where it came from, and offered to
   * add a film you already had.
   *
   * The list is the same query the Films tab uses, so this is a cache read
   * on any screen that has already loaded it and one shared request where
   * it has not — not nine call sites each remembering to pass a prop.
   */
  const { data: myMovies } = useListMovies({
    query: { queryKey: getListMoviesQueryKey(), enabled: visible && isLoggedIn },
  });

  const savedMovie = useMemo(() => {
    if (swapped) return undefined;
    if (savedMovieProp) return savedMovieProp;
    return myMovies?.movies?.find((m) => m.tmdbId === tmdbId);
  }, [swapped, savedMovieProp, myMovies, tmdbId]);

  // Back to the film the parent opened whenever the sheet is dismissed, so
  // reopening does not resume somewhere the user did not leave off.
  useEffect(() => {
    if (!visible) setSwapped(null);
  }, [visible]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [optimisticRating, setOptimisticRating] = useState<number | null | undefined>(undefined);
  const [optimisticWatched, setOptimisticWatched] = useState<boolean | undefined>(undefined);
  const [recommendVisible, setRecommendVisible] = useState(false);
  const [addToPlaylistVisible, setAddToPlaylistVisible] = useState(false);

  // Fetch full TMDB details — parent only renders this component when a movie
  // is selected, so the hook always runs against a valid tmdbId.
  const region = useMemo(() => getDeviceRegion(), []);
  const { data: details, isLoading } = useGetMovieDetails(tmdbId, { region });

  // Use Clerk auth state — works for both saved and unsaved films

  // Pre-fetch the followee list so we know whether to show the recommend button.
  // Only runs when the modal is open and the user is signed in.
  const { data: notifUsersData } = useGetNotificationUsers({
    query: { queryKey: getGetNotificationUsersQueryKey(), enabled: isLoggedIn && visible },
  });
  const followingCount = notifUsersData?.users?.length ?? 0;

  const { mutateAsync: patchWatched, isPending: isWatchingPending } = usePatchWatched();
  const { mutateAsync: patchRating, isPending: isRatingPending } = usePatchRating();
  const { mutateAsync: addMovie, isPending: isAddingPending } = useAddMovie();
  const { showToast } = useToast();

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: getListMoviesQueryKey() });
  }, [queryClient]);

  // Resolved values: prefer optimistic > savedMovie > details
  const currentRating =
    optimisticRating !== undefined ? optimisticRating : savedMovie?.rating ?? null;
  const currentWatched =
    optimisticWatched !== undefined ? optimisticWatched : savedMovie?.isWatched ?? false;

  const displayDirector = details?.director ?? '';
  const displayCast = details?.cast ?? [];
  // Person ids, when the details call has returned them. A name is only
  // tappable if we know who it points at; the saved-movie path has the
  // names but not the ids, so it stays plain text rather than offering a
  // link that would go nowhere.
  const directorRef = details?.directorRef ?? null;
  const castRefs = details?.castRefs ?? [];

  const displayGenres = details?.genres ?? [];
  const displayLanguage = details?.language ?? '';
  const displayProviders = details?.watchProviders ?? [];
  const displayOverview = details?.overview || overview;
  const displayTmdbRating = details?.tmdbRating ?? null;
  const displayTmdbVoteCount = details?.tmdbVoteCount ?? 0;
  const displayRuntime = formatRuntime(details?.runtime);

  /**
   * True while a finger is on either set of stars.
   *
   * The sheet's body scrolls, and on Android a native scroll view does not
   * ask for a gesture it wants — it takes it and tells JS afterwards. A
   * drag along the stars was being swallowed by that the moment it moved,
   * which is why a tap set a rating perfectly well and sliding for a half
   * never worked. Holding the scroll still for the length of the gesture is
   * the only reliable way to keep it.
   */
  const [starActive, setStarActive] = useState(false);

  const handleRating = useCallback(
    async (n: number, viaDrag: boolean) => {
      if (!savedMovie) return;
      // Tapping the star you already have clears the rating — the only way
      // to un-rate a film. Sliding onto it does not: landing on your own
      // score while dragging is how you confirm it, not how you delete it.
      const newRating = !viaDrag && currentRating === n ? null : n;
      setOptimisticRating(newRating);
      if (Platform.OS !== 'web') Haptics.selectionAsync();
      try {
        await patchRating({ id: savedMovie.id, data: { rating: newRating } });
        await invalidate();
      } catch (err) {
        setOptimisticRating(undefined);
        // The server's own words, not a generic line. A rating can fail for
        // reasons worth reading — a half-star reaching a server that has
        // not had the column widened yet says exactly that, and "Could not
        // update rating" sends the reader nowhere.
        const detail = err instanceof Error ? err.message : '';
        Alert.alert('Could not update rating', detail || 'Please try again.');
      }
    },
    [savedMovie, currentRating, patchRating, invalidate]
  );

  const handleToggleWatched = useCallback(async () => {
    if (!savedMovie) return;
    const next = !currentWatched;
    setOptimisticWatched(next);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await patchWatched({ id: savedMovie.id, data: { isWatched: next } });
      await invalidate();
    } catch {
      setOptimisticWatched(undefined);
      Alert.alert('Error', 'Could not update watched status.');
    }
  }, [savedMovie, currentWatched, patchWatched, invalidate]);

  const handleClose = useCallback(() => {
    setOptimisticRating(undefined);
    setOptimisticWatched(undefined);
    onClose();
  }, [onClose]);

  /**
   * Add the film, either to the watchlist or straight to watched.
   *
   * One call rather than add-then-patch: the server takes isWatched on the
   * way in, and a film already on the watchlist is promoted instead of
   * ignored — which is the usual case for "I've finally seen this".
   */
  /**
   * Tapping a similar film swaps this sheet for that one.
   *
   * Closing first, then reopening, rather than stacking a second modal on
   * top: three deep and the only way back is dismissing them one at a time.
   * The parent owns which film is shown, so this goes out through onClose
   * and a push, which every screen that renders this modal already handles.
   */
  const onSimilarPick = useCallback((movie: TmdbMovieCard) => setSwapped(movie), []);

  /**
   * Google, for the things the app does not hold — reviews, trivia, where a
   * remake sits in the sequence, whether the follow-up is worth it.
   *
   * The year and the word "film" go into the query because a title on its
   * own is ambiguous more often than it looks: remakes share names, and
   * plenty of films share theirs with a band or a novel.
   */
  const openWebSearch = useCallback(() => {
    const query = releaseYear ? `${title} ${releaseYear} film` : `${title} film`;
    Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(query)}`).catch(() => {
      Alert.alert('Unable to open link', 'Could not open a web search for this film.');
    });
  }, [title, releaseYear]);

  /**
   * Back to the post the film was saved from.
   *
   * Opened with Linking rather than an in-app browser so the platform's own
   * app takes it where one is installed — a reel is worth more in Instagram
   * than in a web view that will ask you to log in.
   */
  // The locker row first, since it is this viewer's own record of where
  // the film came from; the caller's as a fallback, for a film they have
  // not saved. A swapped film (tapped from "more like this") keeps neither,
  // because the source belonged to the film that was open before it.
  const sourceUrl = swapped ? null : savedMovie?.sourceUrl ?? sourceUrlProp ?? null;
  const source = useMemo(() => (sourceUrl ? describeSource(sourceUrl) : null), [sourceUrl]);
  const openSource = useCallback(() => {
    if (!sourceUrl) return;
    Linking.openURL(sourceUrl).catch(() => {
      Alert.alert('Unable to open link', 'That post could not be opened. It may have been taken down.');
    });
  }, [sourceUrl]);

  /** Open a director or actor's filmography, closing this sheet first. */
  const openPerson = useCallback((personId: number) => {
    handleClose();
    router.push(`/person/${personId}`);
  }, [handleClose, router]);

  const handleAdd = useCallback(async (asWatched: boolean) => {
    try {
      await addMovie({
        data: {
          tmdbId,
          title: details?.title ?? title,
          releaseYear: details?.releaseYear ?? releaseYear,
          posterUrl: details?.posterUrl ?? posterUrl,
          overview: displayOverview,
          ...(asWatched ? { isWatched: true } : {}),
        },
      });
      await invalidate();
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({
        title: asWatched ? 'Added to Watched' : 'Added to Watchlist',
        subtitle: `"${title}" is now in your ${asWatched ? 'watched list' : 'watchlist'}.`,
        variant: 'success',
      });
      handleClose();
      // Land on whichever list it went to, rather than always the watchlist.
      // One tab now, with a toggle. Both lists live behind the same route,
      // so there is no longer a second path to send anyone down.
      router.push('/(tabs)/watchlist');
    } catch {
      showToast({ title: 'Could not add this film', subtitle: 'Please try again.', variant: 'error' });
    }
  }, [addMovie, tmdbId, title, releaseYear, posterUrl, details, displayOverview, invalidate, showToast, handleClose, router]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.root, { paddingTop: insets.top }]}>
          {/* Close button — top offset includes the safe-area inset so it
              sits below the status bar rather than under it (which also
              made it untappable, since the opaque status bar was
              intercepting the touch before it reached the button). */}
          <TouchableOpacity style={[styles.closeBtn, { top: insets.top + 12 }]} onPress={handleClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={!starActive}
          >
            {/* Poster */}
            <View style={styles.posterContainer}>
              <Image
                source={{ uri: posterUrl }}
                style={styles.poster}
                contentFit="cover"
                transition={300}
                placeholder={require('@/assets/images/icon.png')}
              />
              <View style={styles.posterOverlay}>
                <Text style={styles.posterTitle} numberOfLines={2}>{title}</Text>
                <Text style={styles.posterYear}>
                  {releaseYear}
                  {displayRuntime ? ` · ${displayRuntime}` : ''}
                </Text>
              </View>
            </View>

            {/* Content */}
            <View style={styles.content}>

              {/* Genre tags */}
              {displayGenres.length > 0 && (
                <View style={styles.tagRow}>
                  {displayGenres.map((g) => <GenreTag key={g} label={g} />)}
                </View>
              )}

              {/* Director + Language */}
              {isLoading && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.loadingText}>Loading details…</Text>
                </View>
              )}

              {displayRuntime ? (
                <View style={styles.metaRow}>
                  <Ionicons name="time-outline" size={15} color={colors.textMuted} style={styles.metaIcon} />
                  <Text style={styles.metaLabel}>Runtime</Text>
                  <Text style={styles.metaValue}>{displayRuntime}</Text>
                </View>
              ) : null}

              {displayTmdbRating != null ? (
                <View style={styles.metaRow}>
                  <Ionicons name="star" size={15} color="#F59E0B" style={styles.metaIcon} />
                  <Text style={styles.metaLabel}>TMDB Rating</Text>
                  <Text style={styles.metaValue}>
                    {displayTmdbRating.toFixed(1)}/10 · {formatVoteCount(displayTmdbVoteCount)} votes
                  </Text>
                </View>
              ) : null}

              {displayDirector ? (
                <View style={styles.metaRow}>
                  <Ionicons name="film-outline" size={15} color={colors.textMuted} style={styles.metaIcon} />
                  <Text style={styles.metaLabel}>Director</Text>
                  {directorRef ? (
                    <Text
                      style={[styles.metaValue, styles.metaValueLink]}
                      onPress={() => openPerson(directorRef.id)}
                    >
                      {displayDirector}
                    </Text>
                  ) : (
                    <Text style={styles.metaValue}>{displayDirector}</Text>
                  )}
                </View>
              ) : null}

              {displayLanguage ? (
                <View style={styles.metaRow}>
                  <Ionicons name="language-outline" size={15} color={colors.textMuted} style={styles.metaIcon} />
                  <Text style={styles.metaLabel}>Language</Text>
                  <Text style={styles.metaValue}>{displayLanguage}</Text>
                </View>
              ) : null}

              {/* Lead Actors */}
              {displayCast.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Lead Actors</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8 }}
                  >
                    {displayCast.slice(0, 8).map((name, i) => {
                      const ref = castRefs[i];
                      // Matched by position: castRefs is built from the same
                      // billing-ordered slice as cast, so index i is the same
                      // person in both. Falls back to a plain pill when the
                      // ids are not present.
                      if (!ref || ref.name !== name) {
                        return (
                          <View key={name} style={styles.actorPill}>
                            <Text style={styles.actorName}>{name}</Text>
                          </View>
                        );
                      }
                      return (
                        <TouchableOpacity
                          key={`${ref.id}`}
                          style={[styles.actorPill, styles.actorPillLink]}
                          onPress={() => openPerson(ref.id)}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.actorName, styles.actorNameLink]}>{name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              {/* Where to Watch */}
              {displayProviders.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Where to Watch</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: 4 }}
                  >
                    {displayProviders.map((p) => (
                      <ProviderPill
                        key={p.provider_id}
                        provider={p}
                        movieTitle={details?.title ?? title}
                      />
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Synopsis */}
              {displayOverview ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Synopsis</Text>
                  <Text style={styles.synopsisText}>{displayOverview}</Text>
                </View>
              ) : null}

              {/* Back to where this film came from. Above the web search
                  rather than below it: this one is specific to how THIS
                  person found the film, and the search is the generic
                  fallback. Absent entirely for a film that came from a
                  search or the camera, which have no post behind them. */}
              {source && sourceUrl ? (
                <View style={styles.section}>
                  <TouchableOpacity
                    style={styles.webSearchRow}
                    onPress={openSource}
                    activeOpacity={0.7}
                  >
                    <Ionicons name={source.icon} size={16} color={colors.primary} />
                    <Text style={styles.webSearchText}>{source.label}</Text>
                    <Ionicons name="open-outline" size={14} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* Out to the web, for everything the app does not hold. Sits
                  under the synopsis because that is the point someone has
                  read what we have and wants more of it. */}
              <View style={styles.section}>
                <TouchableOpacity
                  style={styles.webSearchRow}
                  onPress={openWebSearch}
                  activeOpacity={0.7}
                >
                  <Ionicons name="globe-outline" size={16} color={colors.primary} />
                  <Text style={styles.webSearchText}>Search the web for this film</Text>
                  <Ionicons name="open-outline" size={14} color={colors.primary} />
                </TouchableOpacity>
              </View>

              {/* ── Community Section — Film Locker's own ratings and
                  written comments. The TMDB rating above is just a number;
                  this is the only place actual written opinions live. ── */}
              <SimilarFilms tmdbId={tmdbId} visible={visible} onPick={onSimilarPick} />

              <CommunitySection
                tmdbId={tmdbId}
                isLoggedIn={isLoggedIn}
                // The server copies a community rating onto this viewer's own
                // rating of the film, so the stars for it have to move too.
                // The optimistic value is what the private stars actually
                // read from, and it survives a refetch — so refetching alone
                // would leave them stale, which is how this looked broken.
                onStarInteraction={setStarActive}
                onRatingChanged={(n) => {
                  setOptimisticRating(n);
                  void invalidate();
                }}
              />

              {/* Divider */}
              <View style={styles.divider} />

              {/* Actions (only for saved movies) */}
              {savedMovie ? (
                <>
                  {/* Star rating */}
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Your Rating</Text>
                    <StarRating
                      value={currentRating}
                      onChange={handleRating}
                      onInteractionChange={setStarActive}
                    />
                    {isRatingPending && (
                      <Text style={styles.savingText}>Saving…</Text>
                    )}
                  </View>

                  {/* Mark as Watched / Move to Watchlist */}
                  <TouchableOpacity
                    style={[
                      styles.actionButton,
                      currentWatched
                        ? styles.actionButtonSecondary
                        : styles.actionButtonPrimary,
                    ]}
                    onPress={handleToggleWatched}
                    disabled={isWatchingPending}
                    activeOpacity={0.85}
                  >
                    {isWatchingPending ? (
                      <ActivityIndicator color={colors.onColor} size="small" />
                    ) : (
                      <>
                        <Ionicons
                          name={currentWatched ? 'bookmark-outline' : 'checkmark-circle-outline'}
                          size={20}
                          color={colors.onColor}
                          style={{ marginRight: 8 }}
                        />
                        <Text style={styles.actionButtonText}>
                          {currentWatched ? 'Move to Watchlist' : 'Mark as Watched'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                /* Add to Watchlist, with Watched beside it.
                   Flex 1 against flex 0.4 gives the second button 40% of the
                   first's width, which keeps the primary action primary —
                   most films are added to watch later, not already seen. */
                <View style={styles.addRow}>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.actionButtonPrimary, styles.addPrimary]}
                    onPress={() => handleAdd(false)}
                    disabled={isAddingPending}
                    activeOpacity={0.85}
                  >
                    {isAddingPending ? (
                      <ActivityIndicator color={colors.onColor} size="small" />
                    ) : (
                      <>
                        <Ionicons
                          name="bookmark-outline"
                          size={20}
                          color={colors.onColor}
                          style={{ marginRight: 8 }}
                        />
                        <Text style={styles.actionButtonText}>Add to Watchlist</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionButton, styles.actionButtonWatched, styles.addSecondary]}
                    onPress={() => handleAdd(true)}
                    disabled={isAddingPending}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={18}
                      color={colors.primary}
                      style={{ marginRight: 5 }}
                    />
                    <Text style={styles.actionButtonWatchedText} numberOfLines={1}>Watched</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Recommend to a friend — shown whenever the user is signed in */}
              {isLoggedIn && (
                <TouchableOpacity
                  style={[styles.actionButton, styles.actionButtonRecommend]}
                  onPress={() => setRecommendVisible(true)}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name="paper-plane-outline"
                    size={20}
                    color={colors.primary}
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.actionButtonRecommendText}>Recommend to…</Text>
                </TouchableOpacity>
              )}

              {/* Add to Playlist — shown whenever the user is signed in */}
              {isLoggedIn && (
                <TouchableOpacity
                  style={[styles.actionButton, styles.actionButtonRecommend]}
                  onPress={() => setAddToPlaylistVisible(true)}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name="list-outline"
                    size={20}
                    color={colors.primary}
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.actionButtonRecommendText}>Add to Playlist</Text>
                </TouchableOpacity>
              )}

            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      {/* Recommend sheet */}
      <RecommendSheet
        visible={recommendVisible}
        onClose={() => setRecommendVisible(false)}
        tmdbId={tmdbId}
        filmTitle={title}
        posterUrl={posterUrl}
      />

      {/* Add to Playlist sheet */}
      <AddToPlaylistSheet
        visible={addToPlaylistVisible}
        onClose={() => setAddToPlaylistVisible(false)}
        tmdbId={tmdbId}
        title={title}
        posterUrl={posterUrl}
      />
    </Modal>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 16,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  posterContainer: { width: W, height: POSTER_HEIGHT, position: 'relative' },
  poster: { width: '100%', height: '100%' },
  posterOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  posterTitle: {
    color: c.onColor,
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    lineHeight: 30,
  },
  posterYear: {
    color: c.star,
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    marginTop: 4,
  },
  content: { paddingHorizontal: 20, paddingTop: 20 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  loadingText: { marginLeft: 8, fontSize: 13, color: c.textMuted, fontFamily: 'Inter_400Regular' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  metaIcon: { marginRight: 8 },
  metaLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: c.textMuted,
    width: 72,
  },
  metaValue: { fontSize: 14, fontFamily: 'Inter_400Regular', color: c.text, flex: 1 },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: c.text,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  actorPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
  },
  actorName: { fontSize: 13, fontFamily: 'Inter_500Medium', color: c.textStrong },
  synopsisText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: c.textStrong,
    lineHeight: 22,
  },
  divider: { height: 1, backgroundColor: c.border, marginVertical: 20 },
  savingText: { fontSize: 12, color: c.textFaint, marginTop: 6, fontFamily: 'Inter_400Regular' },
  addRow: { flexDirection: 'row', gap: 8 },
  webSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.primarySofter,
    backgroundColor: c.primarySoft,
  },
  webSearchText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: c.primary,
  },
  // 1 : 0.4 — the second button is 40% the width of the first.
  addPrimary: { flex: 1, marginBottom: 0 },
  addSecondary: { flex: 0.4, marginBottom: 0, paddingHorizontal: 4 },
  actionButtonWatched: { backgroundColor: c.primarySoft, borderWidth: 1, borderColor: c.primaryBorder },
  actionButtonWatchedText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: c.primary },
  metaValueLink: { color: c.primary, textDecorationLine: 'underline' },
  actorPillLink: { backgroundColor: c.primarySoft, borderWidth: 1, borderColor: c.primaryBorder },
  actorNameLink: { color: c.primary },
  similarCard: { width: 108 },
  similarPoster: { width: 108, height: 162, borderRadius: 8, backgroundColor: c.surfaceAlt },
  similarTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: c.text, marginTop: 6 },
  similarYear: { fontSize: 11, fontFamily: 'Inter_400Regular', color: c.textFaint, marginTop: 1 },
  actionButton: {
    height: 52,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  actionButtonPrimary: { backgroundColor: c.primary },
  actionButtonSecondary: { backgroundColor: c.star },
  actionButtonText: {
    color: c.onColor,
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  actionButtonRecommend: {
    backgroundColor: c.primarySoft,
    borderWidth: 1.5,
    borderColor: c.primaryBorder,
  },
  actionButtonRecommendText: {
    color: c.primary,
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
});
