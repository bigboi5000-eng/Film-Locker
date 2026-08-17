import { Alert, Platform } from 'react-native';

/**
 * Cross-platform destructive confirm dialog.
 *
 * react-native-web's Alert.alert() is a no-op stub (react-native-web ships
 * `class Alert { static alert() {} }`) — on web it renders nothing and never
 * fires any button callback, so anything gated behind it silently does
 * nothing. Falls back to the browser's native window.confirm() on web;
 * native platforms keep using the real Alert.alert.
 */
export function confirmDestructive(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void
): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
