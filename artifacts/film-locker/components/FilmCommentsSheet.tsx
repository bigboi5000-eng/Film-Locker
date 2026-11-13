/**
 * A film's comments, over whatever you were looking at.
 *
 * The feed's Comment button used to open the whole film sheet and scroll
 * it down to the comments, which answers the question but takes the feed
 * away to do it — you lose your place in the list to read three replies,
 * and getting back means closing a full-screen sheet.
 *
 * This is the shape people already know from every social app: a panel up
 * from the bottom, the thread in it, a box at the foot to add your own,
 * and the card you tapped still visible behind. The thread itself is the
 * shared hook, so posting, deleting, reporting and blocking behave exactly
 * as they do on the film's own screen.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommentRow, ReportSheet, useFilmCommentThread, type FilmComment } from '@/components/filmComments';
import { useRequireAccount } from '@/hooks/useRequireAccount';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import { webInputReset } from '@/lib/webInputReset';
import type { Palette } from '@/constants/colors';

const COMMENT_MAX = 280;

export function FilmCommentsSheet({
  visible,
  tmdbId,
  filmTitle,
  isLoggedIn,
  onClose,
}: {
  visible: boolean;
  tmdbId: number;
  filmTitle: string;
  isLoggedIn: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const requireAccount = useRequireAccount();
  // Only fetches while open: the feed mounts one of these per tap, and a
  // closed sheet asking for comments is a request for a screen nobody is
  // looking at.
  const thread = useFilmCommentThread(tmdbId, visible);

  const canPost = thread.commentText.trim().length > 0 && !thread.posting;

  const handlePost = () => {
    if (!requireAccount('comment on films')) return;
    void thread.post();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        // 'height' on Android, NOT undefined. Undefined means the view does
        // nothing at all, so the sheet stayed where it was and the keyboard
        // was drawn straight over the box you were typing into. Every other
        // sheet in this app already says this; I wrote the broken spelling
        // anyway.
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* The feed stays visible behind it — the point of not using the
            full film sheet. */}
        <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={styles.title}>
              {thread.comments.length === 0
                ? 'Comments'
                : thread.comments.length === 1
                  ? '1 comment'
                  : `${thread.comments.length} comments`}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <Text style={styles.filmTitle} numberOfLines={1}>{filmTitle}</Text>

          {thread.isLoading && thread.comments.length === 0 ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 40 }} />
          ) : (
            <FlatList<FilmComment>
              data={thread.comments}
              keyExtractor={(c) => String(c.id)}
              renderItem={({ item }) => (
                <CommentRow comment={item} onDelete={thread.remove} onReport={thread.setReportTarget} />
              )}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Ionicons name="chatbubble-outline" size={34} color={colors.iconFaint} />
                  <Text style={styles.emptyTitle}>No comments yet</Text>
                  <Text style={styles.emptySub}>Be the first to say something about this film.</Text>
                </View>
              }
              ListFooterComponent={
                thread.hasMore ? (
                  <TouchableOpacity style={styles.loadMore} onPress={thread.loadMore} activeOpacity={0.7}>
                    <Text style={styles.loadMoreText}>Load more comments</Text>
                  </TouchableOpacity>
                ) : null
              }
            />
          )}

          {/* The composer, pinned to the foot of the sheet. Shown signed
              out too: tapping it explains what is needed, which is more
              use than a row that is simply absent. */}
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={thread.commentText}
              onChangeText={(t) => thread.setCommentText(t.slice(0, COMMENT_MAX))}
              placeholder={isLoggedIn ? 'Add a comment…' : 'Sign in to comment'}
              placeholderTextColor={colors.textFaint}
              maxLength={COMMENT_MAX}
              multiline
              onPressIn={isLoggedIn ? undefined : () => requireAccount('comment on films')}
              editable={isLoggedIn}
            />
            <TouchableOpacity
              style={[styles.sendBtn, !canPost && styles.sendBtnOff]}
              onPress={handlePost}
              disabled={!canPost}
              activeOpacity={0.8}
            >
              {thread.posting ? (
                <ActivityIndicator size="small" color={colors.onColor} />
              ) : (
                <Ionicons name="arrow-up" size={18} color={colors.onColor} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        <ReportSheet
          visible={thread.reportTarget !== null}
          targetUsername={thread.reportTarget?.username ?? 'this user'}
          onSubmit={thread.sendReport}
          onBlock={thread.blockFromReport}
          onClose={() => thread.setReportTarget(null)}
          submitting={thread.reportPending}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: c.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    // Tall enough to be a thread rather than a peek, short enough that the
    // card you tapped is still behind it.
    height: '75%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: c.border,
    alignSelf: 'center', marginTop: 10, marginBottom: 8,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 20,
  },
  title: { fontSize: 16, fontFamily: 'Inter_700Bold', color: c.text },
  closeBtn: { position: 'absolute', right: 16, padding: 4 },
  filmTitle: {
    fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textFaint,
    textAlign: 'center', marginTop: 2, paddingHorizontal: 20, paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
  },
  // flex: 1 is right HERE, unlike the share sheet's list: this sheet has a
  // definite height, so there is real space to divide between the thread
  // and the composer pinned below it.
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: c.textStrong },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: c.textFaint, textAlign: 'center' },
  loadMore: { alignItems: 'center', paddingVertical: 12 },
  loadMoreText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.primary },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
    backgroundColor: c.background,
  },
  input: {
    flex: 1,
    minHeight: 40, maxHeight: 110,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
    borderRadius: 20, borderWidth: 1, borderColor: c.border,
    backgroundColor: c.surfaceSubtle,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: c.text,
    ...webInputReset,
  },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.primary,
  },
  sendBtnOff: { backgroundColor: c.border },
});
