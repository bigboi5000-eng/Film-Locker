import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import ReceiveSharingIntent from 'react-native-receive-sharing-intent';
import {
  useProcessSocialLink,
  type GeminiMovieMatch,
  type Movie,
} from '@workspace/api-client-react';
import { AiResultSheet } from '@/components/AiResultSheet';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ShareResult = { matches: GeminiMovieMatch[]; saved: Movie[] };

export function ShareIntentHandler() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { mutateAsync: processLink, isPending } = useProcessSocialLink();
  const [result, setResult] = useState<ShareResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  // Track the last handled URL so we don't re-process on AppState resume
  const handledRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  // Android-only — share intents are an Android feature in this app
  if (Platform.OS !== 'android') return null;

  useEffect(() => {
    mountedRef.current = true;

    ReceiveSharingIntent.getReceivedFiles(
      (files: Array<{ weblink?: string; text?: string; filePath?: string }>) => {
        if (!mountedRef.current) return;
        const file = files?.[0];
        if (!file) return;

        // Prefer weblink (a shared URL), fall back to plain text
        const url = file.weblink ?? file.text ?? file.filePath ?? null;
        if (!url) return;
        if (handledRef.current === url) return; // already handling this share
        handledRef.current = url;

        processLink({ data: { url } })
          .then((data) => {
            if (!mountedRef.current) return;
            setResult({ matches: data.matches, saved: data.saved });
            setShowResult(true);
          })
          .catch(() => {
            // Reset so the user can retry this URL by sharing again
            handledRef.current = null;
          });
      },
      () => {
        // Error reading intent — ignore silently
      },
      // Protocol string used for iOS deep link scheme (unused on Android)
      'film-locker',
    );

    return () => {
      mountedRef.current = false;
      ReceiveSharingIntent.clearReceivedFiles();
    };
  }, [processLink]);

  const handleClose = () => {
    setShowResult(false);
    setResult(null);
    handledRef.current = null;
    ReceiveSharingIntent.clearReceivedFiles();
  };

  return (
    <>
      {/* Processing overlay — shown while Gemini extracts films */}
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
              Extracting Films…
            </Text>
            <Text style={[styles.processingSubtitle, { color: colors.mutedForeground }]}>
              Gemini is analysing the shared link
            </Text>
          </View>
        </View>
      </Modal>

      {/* Results bottom sheet */}
      {result !== null && (
        <AiResultSheet
          visible={showResult}
          matches={result.matches}
          saved={result.saved}
          onClose={handleClose}
        />
      )}
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
