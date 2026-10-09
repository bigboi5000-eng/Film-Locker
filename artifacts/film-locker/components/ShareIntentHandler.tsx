/**
 * ShareIntentHandler — Android and iOS.
 *
 * Mounted at the root layout, inside <ShareIntentProvider> (see _layout.tsx).
 * Listens for incoming share intents, calls the API in dry-run mode (no DB
 * write) to identify the film, then shows ShareFilmSheet for user
 * confirmation.
 *
 * The two platforms deliver the same thing by different routes: Android via
 * an intent filter on the main activity, iOS via a share extension (a second
 * bundle, declared by the expo-share-intent config plugin, which hands the
 * URL over through a shared app group). Everything from `shareIntent` onwards
 * is identical, so this component is deliberately not platform-branched —
 * the differences live entirely in app.json.
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
import { useRouter } from 'expo-router';
import { File } from 'expo-file-system';
import {
  useProcessSocialLink,
  useExtractFromImage,
  ExtractFromImageBodyMimeType,
  type GeminiMovieMatch,
} from '@workspace/api-client-react';
import { ShareFilmSheet } from '@/components/ShareFilmSheet';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Narrow a shared file's reported type to one the extractor accepts.
 *
 * The share extension passes on whatever the sending app declared, which is
 * a free string and occasionally carries parameters ("image/jpeg; charset=…")
 * or odd casing. Anything outside the accepted set is rejected here, with a
 * message, rather than cast and refused by the server — a GIF or a PDF
 * shared by mistake should say what happened.
 */
function supportedMimeType(reported: string | undefined): ExtractFromImageBodyMimeType | null {
  const base = reported?.split(';')[0]?.trim().toLowerCase();
  if (!base) return null;
  return base in ExtractFromImageBodyMimeType ? (base as ExtractFromImageBodyMimeType) : null;
}

export function ShareIntentHandler() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { mutateAsync: processLink } = useProcessSocialLink();
  const { mutateAsync: extractFromImage } = useExtractFromImage();
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntentContext();

  // Held in refs so the effect below doesn't need them as dependencies (it
  // would otherwise re-fire on every render).
  const processLinkRef = useRef(processLink);
  useEffect(() => { processLinkRef.current = processLink; }, [processLink]);
  const extractFromImageRef = useRef(extractFromImage);
  useEffect(() => { extractFromImageRef.current = extractFromImage; }, [extractFromImage]);

  const [isPending, setIsPending] = useState(false);
  /** Which kind of share is being worked on, so the overlay can say so. */
  const [pendingKind, setPendingKind] = useState<'link' | 'image'>('link');
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
    if (!hasShareIntent) return;

    // An image takes precedence over any text that came with it: someone
    // sharing a screenshot is sharing the picture, and the accompanying text
    // on a screenshot share is usually a filename.
    const image = shareIntent.files?.find((f) => f.mimeType?.startsWith('image/')) ?? null;

    // Prefer the extracted URL over raw shared text.
    const url = shareIntent.webUrl ?? shareIntent.text ?? null;

    const key = image?.path ?? url;
    if (!key) return;

    // Deduplicate — the same intent can resurface on AppState resume.
    if (handledRef.current === key) return;
    handledRef.current = key;

    // Sharing into the app should always land the user on the Watchlist tab
    // (same place the in-app paste-link flow lives), not wherever the app
    // happened to be showing when the OS launched/resumed it.
    router.replace('/(tabs)/watchlist');

    setPendingKind(image ? 'image' : 'link');
    setIsPending(true);

    const finish = (matches: GeminiMovieMatch[], title: string | null) => {
      if (!mountedRef.current) return;
      setMatches(matches);
      setListTitle(title);
      setShowSheet(true);
    };

    const fail = (message: string) => {
      if (!mountedRef.current) return;
      Alert.alert('Could not identify film', message, [{ text: 'OK' }]);
      handledRef.current = null;
    };

    const done = () => {
      if (mountedRef.current) setIsPending(false);
    };

    if (image) {
      // The extension hands over a path, not the bytes, so this reads the
      // file itself — unlike the in-app picker, which returns base64
      // directly. Guarded on size because base64 inflates a file by about a
      // third and the server refuses anything beyond its own ceiling: a
      // screenshot is a megabyte or two, but a full-resolution photo shared
      // from a library can be far more, and "too large" is a better answer
      // than a failed upload.
      const MAX_SHARED_IMAGE_BYTES = 10 * 1024 * 1024;
      if (typeof image.size === 'number' && image.size > MAX_SHARED_IMAGE_BYTES) {
        setIsPending(false);
        fail('That image is too large to read. Try a screenshot rather than a full-resolution photo.');
        return;
      }

      const mimeType = supportedMimeType(image.mimeType);
      if (!mimeType) {
        setIsPending(false);
        fail('Film Locker can read JPEG, PNG, WebP and HEIC images. That file is a different format.');
        return;
      }

      (async () => {
        const base64 = await new File(image.path).base64();
        return extractFromImageRef.current({
          data: { imageBase64: base64, mimeType, dryRun: true },
        });
      })()
        .then((data) => finish(data.matches ?? [], data.listTitle ?? null))
        .catch(() => fail("Film Locker couldn't read films from that image. Try sharing again."))
        .finally(done);
      return;
    }

    // Call in dry-run mode: identify films without saving to DB.
    processLinkRef.current({ data: { url: url!, dryRun: true } })
      .then((data) => finish(data.matches ?? [], data.listTitle ?? null))
      .catch(() => fail("Film Locker couldn't read this link. Try sharing again."))
      .finally(done);
  }, [hasShareIntent, shareIntent]);

  // Receiving the intent failed at the native level — show an error so the
  // user knows something went wrong rather than a silent blank screen.
  useEffect(() => {
    if (!error) return;
    Alert.alert('Share error', "Film Locker couldn't read the shared content.", [{ text: 'OK' }]);
  }, [error]);

  const handleClose = useCallback(() => {
    setShowSheet(false);
    setMatches([]);
    setListTitle(null);
    handledRef.current = null;
    resetShareIntent();
  }, [resetShareIntent]);

  // There is no share sheet on the web build — the paste-a-link flow on the
  // Watchlist tab covers it there — so render nothing rather than mounting
  // two permanently-invisible modals.
  if (Platform.OS === 'web') return null;

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
              {pendingKind === 'image'
                ? 'Gemini is reading the shared image'
                : 'Gemini is reading the shared link'}
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
