/**
 * ShareIntentHandler — Android only.
 *
 * Mounted at the root layout, inside <ShareIntentProvider> (see _layout.tsx).
 * Listens for incoming share intents, calls the API in dry-run mode (no DB
 * write) to identify the film, then shows ShareFilmSheet for user
 * confirmation.
 *
 * Uses expo-share-intent rather than react-native-receive-sharing-intent —
 * the latter relies on the legacy NativeModules bridge, which crashes with
 * "Film Locker couldn't read the shared content" under the New Architecture
 * (required here by react-native-reanimated 4.x). expo-share-intent is built
 * on the modern Expo Modules API, which supports both architectures.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, Modal, ActivityIndicator, StyleSheet, Platform, Alert } from 'react-native';
import { useShareIntentContext } from 'expo-share-intent';
import {
  useProcessSocialLink,
  type GeminiMovieMatch,
} from '@workspace/api-client-react';
import { ShareFilmSheet } from '@/components/ShareFilmSheet';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function ShareIntentHandler() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { mutateAsync: processLink } = useProcessSocialLink();
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntentContext();

  // Hold processLink in a ref so the effect below doesn't need it as a
  // dependency (it would otherwise re-fire on every render).
  const processLinkRef = useRef(processLink);
  useEffect(() => { processLinkRef.current = processLink; }, [processLink]);

  const [isPending, setIsPending] = useState(false);
  const [matches, setMatches] = useState<GeminiMovieMatch[]>([]);
  const [listTitle, setListTitle] = useState<string | null>(null);
  const [showSheet, setShowSheet] = useState(false);

  // Track the last handled URL so we don't re-process on AppState resume.
  const handledRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!hasShareIntent) return;

    // Prefer the extracted URL over raw shared text.
    const url = shareIntent.webUrl ?? shareIntent.text ?? null;
    if (!url) return;

    // Deduplicate — the same intent can resurface on AppState resume.
    if (handledRef.current === url) return;
    handledRef.current = url;

    setIsPending(true);

    // Call in dry-run mode: identify films without saving to DB.
    processLinkRef.current({ data: { url, dryRun: true } })
      .then((data) => {
        if (!mountedRef.current) return;
        setMatches(data.matches ?? []);
        setListTitle(data.listTitle ?? null);
        setShowSheet(true);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        Alert.alert(
          'Could not identify film',
          "Film Locker couldn't read this link. Try sharing again.",
          [{ text: 'OK' }]
        );
        handledRef.current = null;
      })
      .finally(() => {
        if (mountedRef.current) setIsPending(false);
      });
  }, [hasShareIntent, shareIntent]);

  // Receiving the intent failed at the native level — show an error so the
  // user knows something went wrong rather than a silent blank screen.
  useEffect(() => {
    if (Platform.OS !== 'android' || !error) return;
    Alert.alert('Share error', "Film Locker couldn't read the shared content.", [{ text: 'OK' }]);
  }, [error]);

  const handleClose = useCallback(() => {
    setShowSheet(false);
    setMatches([]);
    setListTitle(null);
    handledRef.current = null;
    resetShareIntent();
  }, [resetShareIntent]);

  if (Platform.OS !== 'android') return null;

  return (
    <>
      {/* Processing overlay — shown while Gemini identifies the film */}
      <Modal transparent visible={isPending} animationType="fade" statusBarTranslucent>
        <View style={styles.overlayBackdrop}>
          <View
            style={[
              styles.processingCard,
              {
                backgroundColor: colors.card,
                marginTop: insets.top + 16,
              },
            ]}
          >
            <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
            <Text style={[styles.processingTitle, { color: colors.foreground }]}>
              Identifying Film…
            </Text>
            <Text style={[styles.processingSubtitle, { color: colors.mutedForeground }]}>
              Gemini is reading the shared link
            </Text>
          </View>
        </View>
      </Modal>

      {/* Film confirmation sheet */}
      <ShareFilmSheet
        visible={showSheet}
        matches={matches}
        listTitle={listTitle}
        onClose={handleClose}
      />
    </>
  );
}

const styles = StyleSheet.create({
  overlayBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  processingCard: {
    borderRadius: 16,
    paddingHorizontal: 28,
    paddingVertical: 28,
    alignItems: 'center',
    width: 260,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  spinner: {
    marginBottom: 16,
  },
  processingTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 6,
  },
  processingSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 18,
  },
});
