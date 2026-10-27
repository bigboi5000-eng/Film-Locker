import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TimeoutError } from '@workspace/api-client-react';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useColors } from '@/hooks/useColors';
import type { Palette } from '@/constants/colors';

/**
 * What a screen shows when its data did not arrive.
 *
 * Worth its own component because the alternative is what every screen
 * here used to do: render the empty state. A list that failed to load and
 * a list with nothing in it look identical from inside the component —
 * `data` is undefined either way — so a network failure announced itself
 * as "Your Watchlist is empty". That is not a smaller problem than a
 * spinner that never stops, it is a bigger one: the spinner is honestly
 * ambiguous, and the empty state is a confident lie about someone's own
 * films.
 *
 * It also names a timeout as a timeout. The request layer knows whether
 * it gave up waiting for the auth token or for the response itself, and
 * that distinction is the one piece of information worth carrying all the
 * way to the screen — it is the difference between the connection being
 * dead and the sign-in refresh being stuck, which look the same from here
 * and need different fixes.
 */
export function LoadError({
  title = 'Could not load this',
  error,
  onRetry,
  retrying = false,
  compact = false,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  /** For a horizontal rail, where the full block would be taller than the row. */
  compact?: boolean;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const blurb =
    error instanceof TimeoutError
      ? error.phase === 'token'
        ? 'Your sign-in took too long to confirm. This usually clears on its own.'
        : 'The connection timed out. Check your signal and try again.'
      : 'Something went wrong reaching the server. Your films are safe.';

  if (compact) {
    return (
      <View style={styles.compactWrap}>
        <Ionicons name="cloud-offline-outline" size={16} color={colors.textFaint} />
        <Text style={styles.compactText} numberOfLines={1}>{title}</Text>
        {onRetry ? (
          <TouchableOpacity onPress={onRetry} disabled={retrying} hitSlop={8}>
            <Text style={styles.compactLink}>{retrying ? 'Retrying…' : 'Retry'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Ionicons name="cloud-offline-outline" size={48} color={colors.iconFaint} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.blurb}>{blurb}</Text>
      {onRetry ? (
        <TouchableOpacity
          style={styles.btn}
          onPress={onRetry}
          disabled={retrying}
          activeOpacity={0.85}
        >
          {retrying ? (
            <ActivityIndicator size="small" color={colors.onColor} />
          ) : (
            <>
              <Ionicons name="refresh" size={16} color={colors.onColor} style={{ marginRight: 6 }} />
              <Text style={styles.btnText}>Try again</Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32 },
  title: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: c.textStrong,
    marginTop: 16,
    textAlign: 'center',
  },
  blurb: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: c.textMuted,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 20,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.primary,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 22,
    marginTop: 20,
    minWidth: 130,
  },
  btnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: c.onColor },

  compactWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  compactText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: c.textMuted },
  compactLink: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: c.primary },
});
