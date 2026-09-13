/**
 * appleSignIn.ts
 *
 * Whether to offer "Continue with Apple".
 *
 * Normally this is iOS-only: Apple requires the button there because the app
 * offers Google sign-in, and showing it on Android is just clutter for people
 * who mostly do not have an Apple ID.
 *
 * Right now it is on for both, temporarily, so the Apple credential chain —
 * Services ID, key, and the return URL registered with Apple — can be
 * exercised from the Android APK before any iOS build exists. That chain is
 * entirely server-side and platform-agnostic: the app opens Clerk in a
 * browser, Apple returns to clerk.film-locker.com, and Clerk hands back to
 * film-locker://oauth-native-callback. Android exercises exactly the same
 * path iOS will, so a success here means the configuration is right.
 *
 * What it does NOT prove is anything about iOS itself, because there is
 * nothing iOS-specific in this implementation to prove.
 *
 * Set back to `Platform.OS === 'ios'` before the Play Store release.
 */
export const SHOW_APPLE_SIGN_IN = true;
