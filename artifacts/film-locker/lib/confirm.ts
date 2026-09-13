import { Alert, Platform } from 'react-native';

/**
 * Cross-platform destructive confirm dialog.
 *
 * react-native-web's Alert.alert() is a no-op stub (react-native-web ships
 * `class Alert { static alert() {} }`) — on web it renders nothing and never
 * fires any button callback, so anything gated behind it silently does
 * nothing. Falls back to the browser's native window.confirm() on web;
 * native platforms keep using the real Alert.alert.
 *
 * Takes a single question rather than a separate title/message — on web,
 * window.confirm() has no styling control and stacks title+message under
 * the raw domain name, which reads as two disjointed lines. One question
 * (e.g. `Remove "Inception" from your watchlist?`) reads cleanly in both
 * the native Alert and the browser's confirm() popup.
 */
export function confirmDestructive(
  question: string,
  confirmLabel: string,
  onConfirm: () => void
): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(question)) {
      onConfirm();
    }
    return;
  }
  Alert.alert(question, undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
