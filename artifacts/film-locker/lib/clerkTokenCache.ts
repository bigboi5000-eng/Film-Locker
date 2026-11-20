import * as SecureStore from 'expo-secure-store';

/**
 * A Clerk token cache that can actually hold a Clerk token.
 *
 * SecureStore refuses values over 2048 bytes — `VALUE_BYTES_LIMIT` in
 * expo-secure-store, which today warns that the value "may not be stored
 * successfully" and in a future SDK will throw. Clerk's JWTs go past that
 * routinely once a session carries more than the bare minimum of claims.
 *
 * The cache shipped in @clerk/expo passes the token straight to
 * setItemAsync with no catch, so when the write failed nothing noticed.
 * The symptom was peculiar and precise: everything worked for about sixty
 * seconds — the lifetime of a Clerk session token held in memory — and
 * then every authenticated request failed, because the refresh needs the
 * stored token and there was nothing stored. No request reached the
 * server, so the server logs stayed empty and the whole thing looked like
 * being signed out. Signing in again minted a fresh in-memory token and
 * bought exactly another sixty seconds.
 *
 * So: anything too big is split across numbered keys behind a manifest.
 * Clerk sees an ordinary cache that keeps what it is given.
 *
 * The chunks are written to one of TWO alternating generations, and the
 * manifest names which one is live. That is not tidiness — it is the
 * whole correctness argument. Writing the new chunks over the old ones
 * and saving the manifest last looks safe, and is not: the old chunks are
 * already gone by then, so an interrupted write leaves the manifest
 * pointing at a mixture of both tokens. getToken then joins them happily
 * and hands Clerk a JWT made of one token's head and another's tail,
 * which verifies as neither and reads as being signed out.
 *
 * iOS is where that bites. A backgrounded app gets a few seconds before
 * it is suspended, and a multi-chunk rewrite is several awaits long, so
 * a refresh that starts as the app goes into the background can be cut
 * in half. Android lets the work finish, which is why this showed up on
 * iPhones and not on the Android build.
 *
 * Writing to the generation that is NOT live means a half-finished write
 * touches nothing anybody is reading. The manifest swap is the single
 * atomic step that makes the new token live, and until it happens the
 * old token is still whole and still correct.
 */

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/**
 * Well under the 2048-byte limit. Clerk tokens are base64url, so one
 * character is one byte and splitting on characters cannot land in the
 * middle of a multi-byte sequence — but the headroom costs nothing and
 * covers a cache key that is not a JWT.
 */
const CHUNK_SIZE = 1500;

/**
 * Marks a value that is really a pointer to numbered chunks.
 *
 * Two shapes are read. `__chunked__:3` is the original, whose chunks live
 * at `key.0…key.2`; it is still read so an app updating from an older
 * build keeps its session instead of being signed out by the upgrade.
 * `__chunked__:3:1:4200` is count, generation and total length.
 */
const MANIFEST = '__chunked__:';

/** How many chunks to look for when clearing, since the count may be lost. */
const MAX_CHUNKS = 32;

/** The two generations chunks alternate between. */
type Generation = 0 | 1;

const chunkKey = (key: string, gen: Generation, i: number) => `${key}.g${gen}.${i}`;

/** The original, generation-less layout, still read for upgrades. */
const legacyChunkKey = (key: string, i: number) => `${key}.${i}`;

interface Manifest {
  count: number;
  /** Null for the legacy layout, whose chunks are not generation-keyed. */
  gen: Generation | null;
  /** Expected total length, or null when the manifest predates it. */
  length: number | null;
}

function parseManifest(head: string): Manifest | null {
  const fields = head.slice(MANIFEST.length).split(':');
  const count = Number(fields[0]);
  if (!Number.isInteger(count) || count <= 0) return null;

  if (fields.length === 1) return { count, gen: null, length: null };

  const gen = Number(fields[1]);
  const length = Number(fields[2]);
  if (gen !== 0 && gen !== 1) return null;
  return { count, gen, length: Number.isInteger(length) ? length : null };
}

function byteLength(value: string): number {
  // No TextEncoder guarantee on every RN runtime, and this only has to be
  // an upper bound: three bytes per character is the worst case short of
  // surrogate pairs, which are counted as two characters anyway.
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
  }
  return bytes;
}

/**
 * Delete one generation's chunks.
 *
 * `count` when it is known, so the usual case is a handful of deletes
 * rather than MAX_CHUNKS of them — Clerk saves on every refresh, about
 * once a minute, and this runs in the middle of it.
 */
async function clearChunks(
  key: string,
  gen: Generation | null,
  count: number = MAX_CHUNKS,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    try {
      await SecureStore.deleteItemAsync(
        gen === null ? legacyChunkKey(key, i) : chunkKey(key, gen, i),
        OPTS,
      );
    } catch {
      /* Nothing there, or the store refused — either way, move on. */
    }
  }
}

/** Every chunk this key could own, in any layout. For a full clear. */
async function clearAllChunks(key: string): Promise<void> {
  await clearChunks(key, null);
  await clearChunks(key, 0);
  await clearChunks(key, 1);
}

export const chunkedTokenCache = {
  async getToken(key: string): Promise<string | null> {
    try {
      const head = await SecureStore.getItemAsync(key, OPTS);
      if (head === null || !head.startsWith(MANIFEST)) return head;

      const manifest = parseManifest(head);
      if (manifest === null) return null;

      const parts: string[] = [];
      for (let i = 0; i < manifest.count; i++) {
        const part = await SecureStore.getItemAsync(
          manifest.gen === null ? legacyChunkKey(key, i) : chunkKey(key, manifest.gen, i),
          OPTS,
        );
        // A missing chunk means a half-written token, which is worse than
        // none: hand back null so Clerk signs in again rather than trying
        // to use a truncated JWT.
        if (part === null) return null;
        parts.push(part);
      }

      const token = parts.join('');
      // The length the manifest recorded, checked against what was
      // actually assembled. The generation swap should make a mismatch
      // impossible; this is here because the failure it catches is
      // indistinguishable from a valid token by inspection, and handing
      // Clerk a plausible-looking wrong JWT is exactly how this was
      // invisible before.
      if (manifest.length !== null && token.length !== manifest.length) return null;
      return token;
    } catch {
      // Deliberately NOT deleting anything here.
      //
      // Clerk's own cache deletes the entry when a read throws, and this
      // did too. That turns a momentary keychain failure into a permanent
      // sign-out: the read is retried seconds later and would have
      // succeeded, but there is no longer anything to read. Returning null
      // is already enough to make Clerk refresh, and leaving the entry
      // alone means the next attempt can still find it.
      return null;
    }
  },

  async saveToken(key: string, token: string): Promise<void> {
    try {
      // Read once, used by both branches: which generation is live, and
      // how many chunks it has, so the sweep below is a few deletes
      // rather than MAX_CHUNKS of them. Clerk saves on every refresh —
      // about once a minute — in the middle of the one operation that
      // must not be slow.
      const previous = await SecureStore.getItemAsync(key, OPTS).catch(() => null);
      const previousManifest =
        previous !== null && previous.startsWith(MANIFEST) ? parseManifest(previous) : null;

      if (byteLength(token) <= CHUNK_SIZE) {
        await SecureStore.setItemAsync(key, token, OPTS);
        if (previousManifest) {
          await clearChunks(key, previousManifest.gen, previousManifest.count);
        }
        return;
      }

      const parts: string[] = [];
      for (let i = 0; i < token.length; i += CHUNK_SIZE) {
        parts.push(token.slice(i, i + CHUNK_SIZE));
      }

      // Whatever is live now, so the new chunks can be written somewhere
      // nothing is reading from.
      const live = previousManifest?.gen ?? null;
      const target: Generation = live === 0 ? 1 : 0;

      for (let i = 0; i < parts.length; i++) {
        await SecureStore.setItemAsync(chunkKey(key, target, i), parts[i], OPTS);
      }
      // The one step that makes the new token live. Everything before it
      // is invisible; if the app is suspended at any point above, the old
      // manifest still names the old generation and the old token is
      // still whole.
      await SecureStore.setItemAsync(
        key,
        `${MANIFEST}${parts.length}:${target}:${token.length}`,
        OPTS,
      );
      // Only now is the previous generation unreachable.
      if (live !== null) await clearChunks(key, live, previousManifest?.count);
      else await clearChunks(key, null, previousManifest?.count);
    } catch (err) {
      // Swallowed deliberately, but not silently. Clerk does not handle a
      // rejection here, and an unhandled one in the middle of a refresh is
      // how this failed invisibly in the first place.
      console.warn('[clerkTokenCache] could not persist token', err);
    }
  },

  async clearToken(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key, OPTS);
      await clearAllChunks(key);
    } catch {
      /* Best effort. */
    }
  },
};
