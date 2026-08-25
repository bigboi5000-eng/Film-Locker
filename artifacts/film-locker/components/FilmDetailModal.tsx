import React, { useCallback, useState, useRef, useMemo } from 'react';
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
  useGetFilmCommunityScore,
  useSetFilmCommunityRating,
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
  type TmdbMovieCard,
  type WatchProvider,
  type FilmComment,
  type NotificationUser,
} from '@workspace/api-client-react';
import { confirmDestructive } from '@/lib/confirm';
import { webInputReset } from '@/lib/webInputReset';
import { getDeviceRegion } from '@/lib/region';
import { useToast } from '@/components/ToastProvider';

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
}

// ── Star rating component ──────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
}: {
  value: number | null | undefined;
  onChange: (n: number) => void;
}) {
  return (
    <View style={starStyles.row}>
      {[1, 2, 3, 4, 5].map((n) => (
        <TouchableOpacity key={n} onPress={() => onChange(n)} hitSlop={8}>
          <Ionicons
            name={typeof value === 'number' && value >= n ? 'star' : 'star-outline'}
            size={28}
            color="#FF8C00"
            style={{ marginHorizontal: 4 }}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const starStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});

// ── Watch Provider pill ────────────────────────────────────────────────────────

const PROVIDER_TYPE_LABEL: Record<string, string> = {
  flatrate: 'Included',
  rent: 'Rent / Buy',
  buy: 'Rent / Buy',
};

const PROVIDER_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  flatrate: { bg: '#D1FAE5', text: '#065F46' }, // green — subscription
  rent:     { bg: '#FFF0DC', text: '#FF8C00' }, // orange — rent/buy
  buy:      { bg: '#FFF0DC', text: '#FF8C00' }, // orange — rent/buy
};

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
  const typeKey = provider.type ?? 'flatrate';
  const label = PROVIDER_TYPE_LABEL[typeKey] ?? typeKey;
  const colors = PROVIDER_TYPE_COLORS[typeKey] ?? PROVIDER_TYPE_COLORS.flatrate;

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
      <View style={[providerStyles.badge, { backgroundColor: colors.bg }]}>
        <Text style={[providerStyles.badgeText, { color: colors.text }]}>
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const providerStyles = StyleSheet.create({
  pill: { alignItems: 'center', marginRight: 14, width: 64 },
  logo: { width: 48, height: 48, borderRadius: 10, marginBottom: 4 },
  logoFallback: { backgroundColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' },
  logoFallbackText: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#6B7280' },
  name: { fontSize: 10, fontFamily: 'Inter_400Regular', color: '#6B7280', textAlign: 'center', marginBottom: 3 },
  badge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  badgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },
});

// ── Genre tag ──────────────────────────────────────────────────────────────────

function GenreTag({ label }: { label: string }) {
  return (
    <View style={tagStyles.tag}>
      <Text style={tagStyles.text}>{label}</Text>
    </View>
  );
}

const tagStyles = StyleSheet.create({
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    marginRight: 6,
    marginBottom: 6,
  },
  text: { fontSize: 12, fontFamily: 'Inter_500Medium', color: '#0066FF' },
});

// ── Community Stars (read-only display) ───────────────────────────────────────

function CommunityStars({ value }: { value: number | null | undefined }) {
  const filled = Math.round(value ?? 0);
  return (
    <View style={{ flexDirection: 'row' }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons
          key={n}
          name={filled >= n ? 'star' : 'star-outline'}
          size={18}
          color="#FF8C00"
          style={{ marginRight: 2 }}
        />
      ))}
    </View>
  );
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
              {[1, 2, 3, 4, 5].map((n) => (
                <Ionicons
                  key={n}
                  name={comment.rating! >= n ? 'star' : 'star-outline'}
                  size={11}
                  color="#FF8C00"
                />
              ))}
            </View>
          )}
          <Text style={commentStyles.time}>{timeAgo}</Text>
          {comment.isOwn ? (
            <TouchableOpacity
              onPress={() => onDelete(comment.id)}
              hitSlop={10}
              style={commentStyles.deleteBtn}
            >
              <Ionicons name="trash-outline" size={14} color="#9CA3AF" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => onReport(comment)}
              hitSlop={10}
              style={commentStyles.deleteBtn}
            >
              <Ionicons name="flag-outline" size={14} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </View>
        <Text style={commentStyles.body}>{comment.body}</Text>
      </View>
    </View>
  );
}

// ── Report sheet — lets you report a comment/user with an optional reason,
// or block the user outright. No in-app moderation queue yet; a report is
// emailed to the developer best-effort and always saved server-side. ──

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
  const [reason, setReason] = useState('');

  const handleClose = useCallback(() => {
    setReason('');
    onClose();
  }, [onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={reportStyles.overlay}>
        <TouchableOpacity style={reportStyles.backdrop} onPress={handleClose} activeOpacity={1} />
        <View style={reportStyles.sheet}>
          <View style={reportStyles.handle} />
          <Text style={reportStyles.title}>Report {targetUsername}</Text>
          <TextInput
            style={reportStyles.input}
            value={reason}
            onChangeText={(t) => setReason(t.slice(0, 1000))}
            placeholder="What's wrong with this? (required)"
            placeholderTextColor="#9CA3AF"
            multiline
            maxLength={1000}
            textAlignVertical="top"
          />
          <TouchableOpacity
            style={[reportStyles.submitBtn, (!reason.trim() || submitting) && reportStyles.btnDisabled]}
            onPress={() => onSubmit(reason.trim())}
            disabled={!reason.trim() || submitting}
            activeOpacity={0.85}
          >
            {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={reportStyles.submitBtnText}>Submit Report</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={reportStyles.blockBtn} onPress={onBlock} activeOpacity={0.85}>
            <Text style={reportStyles.blockBtnText}>Block {targetUsername}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleClose} style={reportStyles.cancelBtn} activeOpacity={0.7}>
            <Text style={reportStyles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const reportStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#111827', marginBottom: 12 },
  input: {
    minHeight: 80, maxHeight: 140, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: 'Inter_400Regular',
    color: '#111827', backgroundColor: '#F9FAFB', marginBottom: 12,
    ...webInputReset,
  },
  submitBtn: {
    backgroundColor: '#0066FF', borderRadius: 10, paddingVertical: 13,
    alignItems: 'center', marginBottom: 10,
  },
  btnDisabled: { opacity: 0.5 },
  submitBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
  blockBtn: {
    borderRadius: 10, paddingVertical: 13, alignItems: 'center',
    borderWidth: 1, borderColor: '#FCA5A5', marginBottom: 10,
  },
  blockBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#DC2626' },
  cancelBtn: { alignItems: 'center', paddingVertical: 8 },
  cancelBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#6B7280' },
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

const commentStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  avatar: { width: 36, height: 36, borderRadius: 18, flexShrink: 0 },
  avatarFallback: { backgroundColor: '#E0E7FF', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#4F46E5' },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  username: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#111827' },
  ratingRow: { flexDirection: 'row', gap: 1 },
  time: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9CA3AF' },
  deleteBtn: { marginLeft: 'auto' },
  body: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#374151', lineHeight: 20 },
});

// ── Community section ─────────────────────────────────────────────────────────

function CommunitySection({
  tmdbId,
  isLoggedIn,
}: {
  tmdbId: number;
  isLoggedIn: boolean;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [commentText, setCommentText] = useState('');
  const [page, setPage] = useState(1);
  // Accumulated comments across all loaded pages
  const [allComments, setAllComments] = useState<FilmComment[]>([]);
  const [reportTarget, setReportTarget] = useState<FilmComment | null>(null);

  const { data: score, isLoading: scoreLoading } = useGetFilmCommunityScore(tmdbId);
  const { data: commentsData, isLoading: commentsLoading } = useGetFilmComments(tmdbId, { page });
  const { mutateAsync: submitRating, isPending: ratingPending } = useSetFilmCommunityRating();
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
    async (n: number) => {
      if (!isLoggedIn) {
        Alert.alert('Sign in required', 'Please sign in to rate this film.');
        return;
      }
      if (Platform.OS !== 'web') Haptics.selectionAsync();
      try {
        await submitRating({ tmdbId, data: { rating: n } });
        await invalidateScore();
      } catch {
        Alert.alert('Error', 'Could not save your rating.');
      }
    },
    [isLoggedIn, submitRating, tmdbId, invalidateScore]
  );

  const handlePostComment = useCallback(async () => {
    const text = commentText.trim();
    if (!text) return;
    try {
      await postComment({ tmdbId, data: { body: text } });
      setCommentText('');
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

  const userRating = score?.userRating ?? null;
  const average = score?.average ?? null;
  const ratingCount = score?.count ?? 0;
  const comments = allComments;
  const hasMore = commentsData?.hasMore ?? false;

  return (
    <View style={communityStyles.container}>
      {/* Section header */}
      <View style={communityStyles.headerRow}>
        <Ionicons name="people-outline" size={16} color="#111827" style={{ marginRight: 6 }} />
        <Text style={communityStyles.title}>COMMUNITY</Text>
      </View>

      {/* Aggregate score */}
      <View style={communityStyles.scoreRow}>
        {scoreLoading ? (
          <ActivityIndicator size="small" color="#0066FF" />
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
        <Text style={communityStyles.userRatingLabel}>Your community rating:</Text>
        <StarRating
          value={userRating}
          onChange={handleCommunityRating}
        />
        {ratingPending && (
          <ActivityIndicator size="small" color="#0066FF" style={{ marginLeft: 8 }} />
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
            placeholderTextColor="#9CA3AF"
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
                <ActivityIndicator size="small" color="#FFFFFF" />
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
        <ActivityIndicator size="small" color="#0066FF" style={{ marginTop: 12 }} />
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

const communityStyles = StyleSheet.create({
  container: {
    marginTop: 4,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  title: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#111827',
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
    color: '#111827',
  },
  ratingCount: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
  },
  userRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  userRatingLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#6B7280',
  },
  divider: { height: 1, backgroundColor: '#F3F4F6', marginBottom: 16 },
  compose: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 12,
    marginBottom: 10,
  },
  input: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#111827',
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
    color: '#9CA3AF',
  },
  postBtn: {
    backgroundColor: '#0066FF',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
    minWidth: 60,
    alignItems: 'center',
  },
  postBtnDisabled: { backgroundColor: '#93C5FD' },
  postBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  signInHint: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
    marginBottom: 10,
    fontStyle: 'italic',
  },
  disclaimer: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
    marginBottom: 16,
    fontStyle: 'italic',
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
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
    color: '#0066FF',
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
              <Ionicons name="checkmark" size={15} color="#FFFFFF" />
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
            <Ionicons name="close" size={22} color="#111827" />
          </TouchableOpacity>
        </View>

        {/* Film pill */}
        <View style={rsStyles.filmPill}>
          <Image source={{ uri: posterUrl }} style={rsStyles.pillPoster} contentFit="cover" />
          <Text style={rsStyles.pillTitle} numberOfLines={2}>{filmTitle}</Text>
        </View>

        {isLoading ? (
          <ActivityIndicator size="large" color="#0066FF" style={{ marginTop: 40 }} />
        ) : users.length === 0 ? (
          <View style={rsStyles.empty}>
            <Ionicons name="people-outline" size={48} color="#D1D5DB" />
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

const rsStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#111827' },
  filmPill: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    padding: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 12,
  },
  pillPoster: { width: 40, height: 60, borderRadius: 6 },
  pillTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#111827', flex: 1 },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, flexShrink: 0 },
  avatarFallback: { backgroundColor: '#E0E7FF', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#4F46E5' },
  username: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: '#111827' },
  sendBtn: {
    backgroundColor: '#0066FF',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnSent: { backgroundColor: '#10B981' },
  sendBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
  separator: { height: 1, backgroundColor: '#F3F4F6', marginLeft: 72 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: '#9CA3AF', textAlign: 'center', paddingHorizontal: 32 },
});

// ── Main component ─────────────────────────────────────────────────────────────

export function FilmDetailModal({
  visible,
  onClose,
  tmdbId,
  title,
  posterUrl,
  releaseYear,
  overview,
  savedMovie,
}: FilmDetailModalProps) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [optimisticRating, setOptimisticRating] = useState<number | null | undefined>(undefined);
  const [optimisticWatched, setOptimisticWatched] = useState<boolean | undefined>(undefined);
  const [recommendVisible, setRecommendVisible] = useState(false);

  // Fetch full TMDB details — parent only renders this component when a movie
  // is selected, so the hook always runs against a valid tmdbId.
  const region = useMemo(() => getDeviceRegion(), []);
  const { data: details, isLoading } = useGetMovieDetails(tmdbId, { region });

  // Use Clerk auth state — works for both saved and unsaved films
  const { isSignedIn } = useAuth();
  const isLoggedIn = Boolean(isSignedIn);

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
  const displayGenres = details?.genres ?? [];
  const displayLanguage = details?.language ?? '';
  const displayProviders = details?.watchProviders ?? [];
  const displayOverview = details?.overview || overview;
  const displayTmdbRating = details?.tmdbRating ?? null;
  const displayTmdbVoteCount = details?.tmdbVoteCount ?? 0;

  const handleRating = useCallback(
    async (n: number) => {
      if (!savedMovie) return;
      const newRating = currentRating === n ? null : n;
      setOptimisticRating(newRating);
      if (Platform.OS !== 'web') Haptics.selectionAsync();
      try {
        await patchRating({ id: savedMovie.id, data: { rating: newRating } });
        await invalidate();
      } catch {
        setOptimisticRating(undefined);
        Alert.alert('Error', 'Could not update rating.');
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

  const handleAddToWatchlist = useCallback(async () => {
    try {
      await addMovie({
        data: {
          tmdbId,
          title: details?.title ?? title,
          releaseYear: details?.releaseYear ?? releaseYear,
          posterUrl: details?.posterUrl ?? posterUrl,
          overview: displayOverview,
        },
      });
      await invalidate();
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: 'Added to Watchlist', subtitle: `"${title}" is now in your watchlist.`, variant: 'success' });
      handleClose();
    } catch {
      showToast({ title: 'Could not add this film', subtitle: 'Please try again.', variant: 'error' });
    }
  }, [addMovie, tmdbId, title, releaseYear, posterUrl, details, displayOverview, invalidate, showToast, handleClose]);

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
          {/* Close button */}
          <TouchableOpacity style={styles.closeBtn} onPress={handleClose} hitSlop={12}>
            <Ionicons name="close" size={22} color="#111827" />
          </TouchableOpacity>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
            keyboardShouldPersistTaps="handled"
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
                <Text style={styles.posterYear}>{releaseYear}</Text>
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
                  <ActivityIndicator size="small" color="#0066FF" />
                  <Text style={styles.loadingText}>Loading details…</Text>
                </View>
              )}

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
                  <Ionicons name="film-outline" size={15} color="#6B7280" style={styles.metaIcon} />
                  <Text style={styles.metaLabel}>Director</Text>
                  <Text style={styles.metaValue}>{displayDirector}</Text>
                </View>
              ) : null}

              {displayLanguage ? (
                <View style={styles.metaRow}>
                  <Ionicons name="language-outline" size={15} color="#6B7280" style={styles.metaIcon} />
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
                    {displayCast.slice(0, 8).map((name) => (
                      <View key={name} style={styles.actorPill}>
                        <Text style={styles.actorName}>{name}</Text>
                      </View>
                    ))}
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

              {/* ── Community Section — Film Locker's own ratings and
                  written comments. The TMDB rating above is just a number;
                  this is the only place actual written opinions live. ── */}
              <CommunitySection tmdbId={tmdbId} isLoggedIn={isLoggedIn} />

              {/* Divider */}
              <View style={styles.divider} />

              {/* Actions (only for saved movies) */}
              {savedMovie ? (
                <>
                  {/* Star rating */}
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Your Rating</Text>
                    <StarRating value={currentRating} onChange={handleRating} />
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
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <>
                        <Ionicons
                          name={currentWatched ? 'bookmark-outline' : 'checkmark-circle-outline'}
                          size={20}
                          color="#FFFFFF"
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
                /* Add to Watchlist (for home screen movies) */
                <TouchableOpacity
                  style={[styles.actionButton, styles.actionButtonPrimary]}
                  onPress={handleAddToWatchlist}
                  disabled={isAddingPending}
                  activeOpacity={0.85}
                >
                  {isAddingPending ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <>
                      <Ionicons
                        name="bookmark-outline"
                        size={20}
                        color="#FFFFFF"
                        style={{ marginRight: 8 }}
                      />
                      <Text style={styles.actionButtonText}>Add to Watchlist</Text>
                    </>
                  )}
                </TouchableOpacity>
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
                    color="#0066FF"
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.actionButtonRecommendText}>Recommend to…</Text>
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
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
    color: '#FFFFFF',
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    lineHeight: 30,
  },
  posterYear: {
    color: '#FF8C00',
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    marginTop: 4,
  },
  content: { paddingHorizontal: 20, paddingTop: 20 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  loadingText: { marginLeft: 8, fontSize: 13, color: '#6B7280', fontFamily: 'Inter_400Regular' },
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
    color: '#6B7280',
    width: 72,
  },
  metaValue: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#111827', flex: 1 },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#111827',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  actorPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  actorName: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#374151' },
  synopsisText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#374151',
    lineHeight: 22,
  },
  divider: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 20 },
  savingText: { fontSize: 12, color: '#9CA3AF', marginTop: 6, fontFamily: 'Inter_400Regular' },
  actionButton: {
    height: 52,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  actionButtonPrimary: { backgroundColor: '#0066FF' },
  actionButtonSecondary: { backgroundColor: '#FF8C00' },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  actionButtonRecommend: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
  },
  actionButtonRecommendText: {
    color: '#0066FF',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
});
