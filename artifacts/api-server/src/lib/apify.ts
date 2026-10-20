/**
 * What the Apify routes share.
 *
 * Small, but worth its own file: both the token check and the actor-id
 * normalisation were otherwise duplicated per platform, and the second
 * platform's copy drifting from the first is exactly the bug nobody finds.
 */

/** Whether the Apify routes are configured at all. One token, any actor. */
export function hasApifyToken(): boolean {
  return Boolean(process.env["APIFY_TOKEN"]);
}

/**
 * Apify writes an actor as `owner/name` everywhere a person reads it — the
 * store page, the console, the docs — and requires `owner~name` in the API
 * path. Copying what is on screen straight into a variable therefore gives
 * a 404 saying the actor was not found, which it is, under that name.
 *
 * Accepting both costs one line and removes the whole class of mistake.
 */
export function normaliseActorId(id: string): string {
  return id.trim().replace("/", "~");
}
