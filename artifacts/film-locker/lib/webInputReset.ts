import { Platform } from 'react-native';

/**
 * react-native-web never resets the browser's default focus outline on the
 * underlying <input> for a TextInput — without this, focusing/typing draws
 * a separate ring around just the input, distinct from (and often uglier
 * than) whatever border the surrounding style already defines. Spread this
 * into any TextInput's style. No-op on native.
 */
export const webInputReset = Platform.OS === 'web' ? { outlineWidth: 0 } : {};
