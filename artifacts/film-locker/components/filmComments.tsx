/**
 * The comment thread on a film: the rows, the report sheet, and the state
 * that drives both.
 *
 * Lifted out of FilmDetailModal, which owned all of it and was the only
 * place comments could be read. The feed now opens them in a sheet of its
 * own, and two copies of "post, paginate, delete, report, block" is how
 * one of them quietly stops honouring a block the other does.
 *
 * The hook holds no layout. The film sheet renders this inline under its
 * ratings; the feed renders it as a bottom sheet over the card you tapped.
 * Those are different enough that sharing a component would mean a prop
 * for every difference, and identical in every rule that matters.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetFilmComments,
  usePostFilmComment,
  useDeleteFilmComment,
  useSubmitReport,
  useBlockUser,
  getGetFilmCommentsQueryKey,
  getGetFollowsQueryKey,
  type FilmComment,
} from '@workspace/api-client-react';
import { StarRating } from '@/components/StarRating';
import { useToast } from '@/components/ToastProvider';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import { confirmDestructive } from '@/lib/confirm';
import { CONTACT_EMAIL } from '@/lib/legalLinks';
import { describeApiError } from '@/lib/apiErrors';
import { webInputReset } from '@/lib/webInputReset';
import type { Palette } from '@/constants/colors';

export type { FilmComment };

// ── Comment row ────────────────────────────────────────────────────────────────

export function CommentRow({
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

export function ReportSheet({
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

export function formatRelative(date: Date): string {
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

// ── The thread's state ────────────────────────────────────────────────────────

/**
 * Everything a comment thread does, minus how it looks.
 *
 * Pagination accumulates rather than replaces, because the list grows
 * downward and a refetch of page 1 would otherwise throw away pages 2 and
 * 3 while somebody was reading them. Posting, deleting and blocking all
 * reset to page 1, since each of them changes what page 1 contains.
 */
export function useFilmCommentThread(tmdbId: number, enabled = true) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [page, setPage] = useState(1);
  const [allComments, setAllComments] = useState<FilmComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [reportTarget, setReportTarget] = useState<FilmComment | null>(null);

  const { data, isLoading } = useGetFilmComments(
    tmdbId,
    { page },
    { query: { queryKey: getGetFilmCommentsQueryKey(tmdbId, { page }), enabled } }
  );
  const { mutateAsync: postComment, isPending: posting } = usePostFilmComment();
  const { mutateAsync: deleteComment } = useDeleteFilmComment();
  const { mutateAsync: submitReport, isPending: reportPending } = useSubmitReport();
  const { mutateAsync: blockUser } = useBlockUser();

  React.useEffect(() => {
    if (!data?.comments) return;
    setAllComments((prev) => {
      const existing = new Set(prev.map((c) => c.id));
      const fresh = data.comments.filter((c) => !existing.has(c.id));
      return page === 1 ? data.comments : [...prev, ...fresh];
    });
  }, [data, page]);

  const reset = useCallback(async () => {
    setPage(1);
    setAllComments([]);
    await queryClient.invalidateQueries({ queryKey: getGetFilmCommentsQueryKey(tmdbId) });
  }, [queryClient, tmdbId]);

  const post = useCallback(async () => {
    const text = commentText.trim();
    if (!text) return;
    try {
      await postComment({ tmdbId, data: { body: text } });
      setCommentText('');
      Keyboard.dismiss();
      await reset();
    } catch (err) {
      const described = describeApiError(err, { action: 'post your comment' });
      Alert.alert(described.title, described.message);
    }
  }, [commentText, postComment, tmdbId, reset]);

  const remove = useCallback(
    (id: number) => {
      confirmDestructive('Remove this comment?', 'Delete', async () => {
        try {
          await deleteComment({ tmdbId, id });
          await reset();
        } catch (err) {
          const described = describeApiError(err, { action: 'delete that comment' });
          Alert.alert(described.title, described.message);
        }
      });
    },
    [deleteComment, tmdbId, reset]
  );

  const sendReport = useCallback(
    async (reason: string) => {
      if (!reportTarget || !reason.trim()) return;
      try {
        await submitReport({
          data: { reportedUserId: reportTarget.userId, reason, commentId: reportTarget.id },
        });
        setReportTarget(null);
        showToast({
          title: 'Report submitted',
          subtitle: "Thanks for flagging it — we'll take a look.",
          variant: 'success',
        });
      } catch {
        showToast({ title: 'Could not submit report', variant: 'error' });
      }
    },
    [reportTarget, submitReport, showToast]
  );

  const blockFromReport = useCallback(() => {
    if (!reportTarget) return;
    const username = reportTarget.username ?? 'this user';
    confirmDestructive(
      `Block ${username}? They won't be able to follow, message, or see your comments, and you won't see theirs.`,
      'Block',
      async () => {
        try {
          await blockUser({ data: { blockedId: reportTarget.userId } });
          setReportTarget(null);
          await reset();
          await queryClient.invalidateQueries({ queryKey: getGetFollowsQueryKey() });
          showToast({ title: `Blocked ${username}`, variant: 'success' });
        } catch {
          showToast({ title: 'Could not block this user', variant: 'error' });
        }
      }
    );
  }, [reportTarget, blockUser, reset, queryClient, showToast]);

  return {
    comments: allComments,
    isLoading,
    hasMore: data?.hasMore ?? false,
    loadMore: useCallback(() => setPage((p) => p + 1), []),
    commentText,
    setCommentText,
    post,
    posting,
    remove,
    reset,
    reportTarget,
    setReportTarget,
    sendReport,
    blockFromReport,
    reportPending,
  };
}
