/**
 * Who can edit a playlist.
 *
 * Two jobs in one sheet, because they are the same question asked from
 * either side. The owner sees everyone on the list and can take somebody
 * off it or invite a Film Pal; a collaborator sees the same people, cannot
 * change them, and can leave. Nobody else opens this.
 *
 * The invite list is the same one the send sheet uses — the people you can
 * message — because that is already the set of Film Pals, and the server
 * re-checks it anyway. Offering a wider list would only produce rejections.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, Modal, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Platform, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetNotificationUsers,
  getGetNotificationUsersQueryKey,
  useListCollaborators,
  getListCollaboratorsQueryKey,
  useAddCollaborator,
  useRemoveCollaborator,
  type Collaborator,
  type NotificationUser,
} from '@workspace/api-client-react';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import { useToast } from '@/components/ToastProvider';
import { collaboratorColorMap, badgeInitials } from '@/lib/collaboratorColors';
import { confirmDestructive } from '@/lib/confirm';
import { webInputReset } from '@/lib/webInputReset';
import type { Palette } from '@/constants/colors';

interface CollaboratorsSheetProps {
  visible: boolean;
  onClose: () => void;
  playlistId: number;
  playlistName: string;
  /**
   * What the playlist response already carried, used until this sheet's own
   * request lands so it opens with the right people rather than with
   * nothing.
   */
  collaborators: Collaborator[];
  /**
   * The cap, where the playlist response carried one. It only does on a
   * list that already has collaborators, so for the common case — an owner
   * sharing a list for the first time — this is undefined and the number
   * comes from the request below rather than from a copy of the server's
   * constant kept here.
   */
  maxCollaborators?: number;
  isOwner: boolean;
  myClerkId: string | null | undefined;
  /** Refetch the playlist so the badges and the avatar row agree again. */
  onChanged: () => void | Promise<void>;
  /** Called after leaving, so the screen can take the person back. */
  onLeft?: () => void;
}

export function CollaboratorsSheet({
  visible,
  onClose,
  playlistId,
  playlistName,
  collaborators: initialCollaborators,
  maxCollaborators: initialMax,
  isOwner,
  myClerkId,
  onChanged,
  onLeft,
}: CollaboratorsSheetProps) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * The authoritative list, and the only place the cap comes from.
   *
   * The playlist response leaves both off a list nobody has been invited
   * to — there is nothing to say — which is exactly the state an owner is
   * in when they first open this sheet. Asking for it here means the
   * client never has to know what the cap is.
   */
  const { data: collabData } = useListCollaborators(playlistId, {
    query: { queryKey: getListCollaboratorsQueryKey(playlistId), enabled: visible },
  });
  const collaborators = collabData?.collaborators ?? initialCollaborators;
  const maxCollaborators = collabData?.maxCollaborators ?? initialMax;

  const { data, isLoading } = useGetNotificationUsers({
    // Only the owner ever sees the invite list, so a collaborator opening
    // this sheet does not fetch a list of their own Film Pals for nothing.
    query: { queryKey: getGetNotificationUsersQueryKey(), enabled: visible && isOwner },
  });
  const { mutateAsync: addCollaborator } = useAddCollaborator();
  const { mutateAsync: removeCollaborator } = useRemoveCollaborator();

  const onList = useMemo(() => new Set(collaborators.map((c) => c.clerkId)), [collaborators]);
  // The same mapping the grid uses, from the same function — the swatches
  // here are the legend FOR those badges, so a second way of working the
  // colours out is a second chance for the two to disagree.
  const colorById = useMemo(
    () => collaboratorColorMap(collaborators, myClerkId),
    [collaborators, myClerkId]
  );
  const invited = collaborators.filter((c) => !c.isOwner);
  // Undefined until the request lands. Treated as "room for more" rather
  // than as zero, so the invite list is not hidden for the moment before
  // the real number arrives.
  const seatsLeft = maxCollaborators === undefined
    ? null
    : Math.max(0, maxCollaborators - invited.length);

  const candidates = useMemo(() => {
    const users = (data?.users ?? []).filter((u) => !onList.has(u.clerkId));
    if (!query.trim()) return users;
    const q = query.trim().toLowerCase();
    return users.filter((u) => (u.username ?? u.clerkId).toLowerCase().includes(q));
  }, [data, onList, query]);

  const close = useCallback(() => {
    setQuery('');
    setBusyId(null);
    onClose();
  }, [onClose]);

  const handleInvite = useCallback(async (user: NotificationUser) => {
    if (busyId) return;
    setBusyId(user.clerkId);
    try {
      // Both mutations answer with the list as it now stands, so it is
      // written straight in rather than refetched: the row disappears or
      // appears under the finger that caused it, with no round trip and no
      // flicker back to the old list in between.
      const next = await addCollaborator({ id: playlistId, data: { userId: user.clerkId } });
      queryClient.setQueryData(getListCollaboratorsQueryKey(playlistId), next);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: `${user.username ?? 'They'} can edit this playlist`, subtitle: playlistName });
      await onChanged();
    } catch (err: unknown) {
      // The server's own words where it has any: "You can only invite Film
      // Pals" and "a playlist can have 5 collaborators" both say something
      // the person can act on, and replacing them with "could not invite"
      // throws that away.
      const detail = err instanceof Error ? err.message : '';
      Alert.alert('Could not invite', detail || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }, [addCollaborator, busyId, onChanged, playlistId, playlistName, queryClient, showToast]);

  const handleRemove = useCallback((person: Collaborator) => {
    const leaving = person.clerkId === myClerkId;
    const name = person.username ?? 'this person';
    confirmDestructive(
      leaving
        ? `Leave "${playlistName}"? Films you added will stay on the list.`
        : `Remove ${name} from "${playlistName}"? Films they added will stay on the list.`,
      leaving ? 'Leave' : 'Remove',
      async () => {
        setBusyId(person.clerkId);
        try {
          const next = await removeCollaborator({ id: playlistId, userId: person.clerkId });
          queryClient.setQueryData(getListCollaboratorsQueryKey(playlistId), next);

          if (leaving) {
            // Off the screen BEFORE the refetch, not after. Leaving a
            // private list means losing sight of it, so the invalidate
            // below reloads the playlist into a 403 — and the person
            // should be back on the previous screen by the time that
            // answer arrives, not watching this one turn into an error.
            close();
            onLeft?.();
            void onChanged();
          } else {
            await onChanged();
          }
        } catch {
          Alert.alert('Error', leaving ? 'Could not leave this playlist.' : `Could not remove ${name}.`);
        } finally {
          setBusyId(null);
        }
      }
    );
  }, [close, myClerkId, onChanged, onLeft, playlistId, playlistName, queryClient, removeCollaborator]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} onPress={close} activeOpacity={1} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderText}>
              <Text style={styles.sheetTitle}>Collaborators</Text>
              <Text style={styles.sheetSubtitle} numberOfLines={2}>
                {isOwner
                  ? `Film Pals you invite can add and remove films.${
                      maxCollaborators === undefined ? '' : ` ${invited.length} of ${maxCollaborators} used.`
                    }`
                  : `You can add and remove films on ${playlistName}.`}
              </Text>
            </View>
            <TouchableOpacity onPress={close} style={styles.closeBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            {/* The legend for the badges on the posters. Every person here
                keeps the colour they have on the grid, which is why the
                order of this list is the server's and not sorted here. */}
            {collaborators.map((person) => {
              const color = colorById.get(person.clerkId) ?? colors.primary;
              const isMe = person.clerkId === myClerkId;
              const canRemove = !person.isOwner && (isOwner || isMe);
              return (
                <View key={person.clerkId} style={styles.personRow}>
                  <View style={[styles.swatch, { backgroundColor: color }]}>
                    <Text style={styles.swatchText}>{badgeInitials(person)}</Text>
                  </View>
                  {person.avatarUrl ? (
                    <Image source={{ uri: person.avatarUrl }} style={styles.avatar} contentFit="cover" />
                  ) : (
                    <View style={[styles.avatar, styles.avatarFallback]}>
                      <Text style={styles.avatarInitials}>{badgeInitials(person)}</Text>
                    </View>
                  )}
                  <View style={styles.personText}>
                    <Text style={styles.personName} numberOfLines={1}>
                      {person.username ?? person.clerkId}{isMe ? ' (you)' : ''}
                    </Text>
                    <Text style={styles.personRole}>{person.isOwner ? 'Owner' : 'Can add and remove films'}</Text>
                  </View>
                  {busyId === person.clerkId ? (
                    <ActivityIndicator size="small" color={colors.textFaint} />
                  ) : canRemove ? (
                    <TouchableOpacity onPress={() => handleRemove(person)} hitSlop={8} activeOpacity={0.7}>
                      <Ionicons
                        name={isMe && !isOwner ? 'exit-outline' : 'close-circle-outline'}
                        size={22}
                        color={colors.destructive}
                      />
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}

            {isOwner && (
              <>
                <View style={styles.divider} />
                <Text style={styles.label}>
                  {seatsLeft === 0
                    ? 'No seats left'
                    : seatsLeft === null
                      ? 'Invite a Film Pal'
                      : `Invite a Film Pal · ${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left`}
                </Text>

                {seatsLeft === 0 ? (
                  <Text style={styles.emptyText}>
                    Remove somebody above to invite a different Film Pal.
                  </Text>
                ) : isLoading ? (
                  <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
                ) : (
                  <>
                    <View style={styles.searchRow}>
                      <Ionicons name="search-outline" size={16} color={colors.textFaint} style={{ marginRight: 8 }} />
                      <TextInput
                        style={styles.searchInput}
                        value={query}
                        onChangeText={setQuery}
                        placeholder="Filter Film Pals…"
                        placeholderTextColor={colors.textFaint}
                        autoCapitalize="none"
                      />
                    </View>

                    {candidates.length === 0 ? (
                      <Text style={styles.emptyText}>
                        {query.trim()
                          ? 'No Film Pals match that.'
                          : 'Film Pals are people who follow each other. Follow somebody back to collaborate with them.'}
                      </Text>
                    ) : (
                      candidates.map((user) => (
                        <TouchableOpacity
                          key={user.clerkId}
                          style={styles.candidateRow}
                          onPress={() => handleInvite(user)}
                          disabled={busyId !== null}
                          activeOpacity={0.7}
                        >
                          {user.avatarUrl ? (
                            <Image source={{ uri: user.avatarUrl }} style={styles.avatar} contentFit="cover" />
                          ) : (
                            <View style={[styles.avatar, styles.avatarFallback]}>
                              <Text style={styles.avatarInitials}>
                                {(user.displayInitials || user.username || '?').slice(0, 5).toUpperCase()}
                              </Text>
                            </View>
                          )}
                          <Text style={styles.candidateName} numberOfLines={1}>
                            {user.username ?? user.clerkId}
                          </Text>
                          {busyId === user.clerkId ? (
                            <ActivityIndicator size="small" color={colors.primary} />
                          ) : (
                            <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
                          )}
                        </TouchableOpacity>
                      ))
                    )}
                  </>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: c.background,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '80%', paddingBottom: 32,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: c.border,
    alignSelf: 'center', marginTop: 10, marginBottom: 6,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
  },
  sheetHeaderText: { flex: 1, marginRight: 12 },
  sheetTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: c.text },
  sheetSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: c.textMuted, marginTop: 2, lineHeight: 18 },
  closeBtn: { padding: 4 },
  body: { paddingHorizontal: 20, paddingTop: 8 },
  divider: { height: 1, backgroundColor: c.surfaceAlt, marginVertical: 16 },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.textMuted, marginBottom: 8 },

  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  swatch: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  swatchText: { color: '#FFFFFF', fontSize: 9, lineHeight: 11, fontFamily: 'Inter_700Bold' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceAlt },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 12, fontFamily: 'Inter_700Bold', color: c.textMuted, paddingHorizontal: 3 },
  personText: { flex: 1 },
  // No flex here: inside personText (a column) flex:1 would stretch the
  // line vertically. The candidate rows lay it out horizontally and add
  // the flex themselves.
  personName: { fontSize: 15, fontFamily: 'Inter_500Medium', color: c.text },
  candidateName: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: c.text },
  personRole: { fontSize: 12, fontFamily: 'Inter_400Regular', color: c.textFaint, marginTop: 1 },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: c.surfaceAlt, borderRadius: 10, marginBottom: 4,
  },
  searchInput: {
    flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: c.text, padding: 0,
    ...webInputReset,
  },
  candidateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  emptyText: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: c.textFaint,
    lineHeight: 18, paddingVertical: 8,
  },
});
