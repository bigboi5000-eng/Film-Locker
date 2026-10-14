/**
 * IdentifyingOverlay — the wait while a film is being identified.
 *
 * One card, three callers' worth of waiting: a link or screenshot arriving
 * through the share sheet, and a photo or pasted link from the search bar
 * inside the app. It exists as its own component rather than as markup in
 * each because the interesting part is the film facts underneath, and a
 * second copy of that is a second copy to keep in step.
 *
 * The wording is the caller's. "Gemini is reading the shared image" is
 * right for something that arrived from another app and wrong for a photo
 * the user just took, and a component that guessed between them from a
 * flag would be a component with a flag.
 */
import React from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FilmFactTicker } from '@/components/FilmFactTicker';
import { useColors } from '@/hooks/useColors';

export interface IdentifyingOverlayProps {
  visible: boolean;
  /** What is being read, in the caller's own words. */
  subtitle: string;
  title?: string;
}

export function IdentifyingOverlay({
  visible,
  subtitle,
  title = 'Identifying Film…',
}: IdentifyingOverlayProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.card, marginTop: insets.top + 16 }]}>
          <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>

          {/* The wait is usually a few seconds and occasionally much longer,
              so it gets something worth reading rather than a spinner on its
              own. Nothing here delays the result. */}
          <View style={styles.divider} />
          <FilmFactTicker />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  card: {
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 26,
    alignItems: 'center',
    width: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  spinner: { marginBottom: 16 },
  title: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 18,
  },
  divider: {
    height: 1,
    alignSelf: 'stretch',
    marginTop: 18,
    marginBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.07)',
  },
});
