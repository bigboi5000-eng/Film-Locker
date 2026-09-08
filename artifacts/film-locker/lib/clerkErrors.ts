/**
 * clerkErrors.ts
 *
 * Pulls the human-readable reason out of a Clerk failure.
 *
 * Clerk's API errors carry a short `message` and a much more useful
 * `longMessage` that names the actual problem — "the redirect url ... does
 * not match an authorized redirect URI for this instance", say. Both were
 * being swallowed in favour of a generic "Please try again", which turned a
 * one-glance configuration error into a blind hunt: the app said only that
 * sign-in had failed, while Clerk had been explicit about why the whole time.
 */
import { isClerkAPIResponseError } from '@clerk/expo';

export function clerkErrorMessage(err: unknown): string | undefined {
  if (isClerkAPIResponseError(err)) {
    const first = err.errors?.[0];
    return first?.longMessage || first?.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return undefined;
}
