/**
 * oauthRedirect.ts
 *
 * The single definition of the URL the OAuth browser flow returns to.
 *
 * When you tap "Continue with Google", the app opens a Custom Tab (Android)
 * or SFSafariViewController (iOS) pointing at Clerk, Clerk bounces you to
 * Google, and Google bounces you back to Clerk. Clerk then needs a way to get
 * you back *into the app* — that is this URL, built from the `scheme`
 * declared in app.json, so in a release build it resolves to:
 *
 *     film-locker://oauth-native-callback
 *
 * Two things make this worth having in its own file rather than inline at
 * each call site:
 *
 * 1. Clerk PRODUCTION instances reject any redirect URL that is not on the
 *    instance's allowlist, and the rejection happens before the browser even
 *    opens. Development instances skip that check entirely, so a value that
 *    works perfectly in development fails outright in production. The exact
 *    string below has to be present in the Clerk Dashboard's allowed redirect
 *    URLs — if you change the path here, change it there in the same breath.
 *
 * 2. Sign-in and sign-up previously each built this string themselves. Two
 *    copies of a value that must match a third copy in a web dashboard is one
 *    copy too many.
 *
 * Note this deliberately does not hardcode the scheme: makeRedirectUri reads
 * it from the app config, which is what keeps the flow working in Expo Go and
 * development builds (where the URL is an exp:// address instead).
 */
import * as AuthSession from 'expo-auth-session';

/** Path segment appended to the app scheme. Mirrored in Clerk's allowlist. */
export const OAUTH_CALLBACK_PATH = 'oauth-native-callback';

export function getOAuthRedirectUrl(): string {
  return AuthSession.makeRedirectUri({ path: OAUTH_CALLBACK_PATH });
}
