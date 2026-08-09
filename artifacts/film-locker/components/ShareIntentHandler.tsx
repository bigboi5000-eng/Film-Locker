/**
 * ShareIntentHandler — Android only.
 *
 * Mounted at the root layout. Listens for incoming share intents, calls the
 * API in dry-run mode (no DB write) to identify the film, then shows
 * ShareFilmSheet for user confirmation.
 *
 * Critical implementation notes:
 *  - useEffect dependency is [] — processLink must be in a ref so the cleanup
 *    (clearReceivedFiles) never runs on a re-render. If the dep were
 *    [processLink], every re-render would call clearReceivedFiles() and wipe
 *    the shared URL before the callback can read it.
 *  - Requires newArchEnabled: false — react-native-receive-sharing-intent uses
 *    the legacy NativeModules bridge which is unreliable with the New Architecture
 *    interop layer on real devices.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
} from 'react-native';
import ReceiveSharingIntent from 'react-native-receive-sharing-intent';
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

  // Hold processLink in a ref so the useEffect can reference the latest
  // version without needing it as a dependency.
  const processLinkRef = useRef(processLink);
  useEffect(() => { processLinkRef.current = processLink; }, [processLink]);

  const [isPending, setIsPending] = useState(false);
  const [matches, setMatches] = useState<GeminiMovieMatch[]>([]);
  const [showSheet, setShowSheet] = useState(false);

  // Track the last handled URL so we don't re-process on AppState resume.
  const handledRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    mountedRef.current = true;

    ReceiveSharingIntent.getReceivedFiles(
      (files: Array<{ weblink?: string; text?: string; filePath?: string }>) => {
        if (!mountedRef.current) return;

        const file = files?.[0];
        if (!file) return;

        // Prefer weblink (shared URL) over plain text.
        const url = file.weblink ?? file.text ?? file.filePath ?? null;
        if (!url) return;

        // Deduplicate — app may receive the same intent on resume.
        if (handledRef.current === url) return;
        handledRef.current = url;

        setIsPending(true);

        // Call in dry-run mode: identify films without saving to DB.
        processLinkRef.current({ data: { url, dryRun: true } })
          .then((data) => {
            if (!mountedRef.current) return;
            setMatches(data.matches ?? []);
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
      },
      (error: unknown) => {
        // Receiving the intent failed at the native level — show an error so
        // the user knows something went wrong rather than a silent blank screen.
        if (!mountedRef.current) return;
        Alert.alert(
          'Share error',
          "Film Locker couldn't read the shared content.",
          [{ text: 'OK' }]
        );
      },
      // Must match the "scheme" in app.json
      'film-locker',
    );

    return () => {
      mountedRef.current = false;
      // Do NOT call clearReceivedFiles() here — doing so would wipe the
      // shared URL if the component unmounts/remounts before the callback fires.
    };
    // Empty deps — intentional. processLink is accessed via ref.
  }, []);

  const handleClose = useCallback(() => {
    setShowSheet(false);
    setMatches([]);
    handledRef.current = null;
    ReceiveSharingIntent.clearReceivedFiles();
  }, []);

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
