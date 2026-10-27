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

/** Marks a value that is really a pointer to numbered chunks. */
const MANIFEST = '__chunked__:';

/** How many chunks to look for when clearing, since the count may be lost. */
const MAX_CHUNKS = 32;

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

async function clearChunks(key: string): Promise<void> {
  for (let i = 0; i < MAX_CHUNKS; i++) {
    try {
      await SecureStore.deleteItemAsync(`${key}.${i}`, OPTS);
    } catch {
      /* Nothing there, or the store refused — either way, move on. */
    }
  }
}

export const chunkedTokenCache = {
  async getToken(key: string): Promise<string | null> {
    try {
      const head = await SecureStore.getItemAsync(key, OPTS);
      if (head === null || !head.startsWith(MANIFEST)) return head;

      const count = Number(head.slice(MANIFEST.length));
      if (!Number.isInteger(count) || count <= 0) return null;

      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await SecureStore.getItemAsync(`${key}.${i}`, OPTS);
        // A missing chunk means a half-written token, which is worse than
        // none: hand back null so Clerk signs in again rather than trying
        // to use a truncated JWT.
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join('');
    } catch {
      // Matches the behaviour of Clerk's own cache: an unreadable entry is
      // cleared rather than retried for ever.
      try {
        await SecureStore.deleteItemAsync(key, OPTS);
        await clearChunks(key);
      } catch {
        /* Best effort. */
      }
      return null;
    }
  },

  async saveToken(key: string, token: string): Promise<void> {
    try {
      if (byteLength(token) <= CHUNK_SIZE) {
        // Chunks are only swept when the value being replaced was actually
        // chunked. Sweeping unconditionally meant thirty-two keystore
        // deletes on every save, and Clerk saves on every refresh — about
        // once a minute, for nothing, in the middle of the one operation
        // that must not be slow.
        const previous = await SecureStore.getItemAsync(key, OPTS).catch(() => null);
        await SecureStore.setItemAsync(key, token, OPTS);
        if (previous?.startsWith(MANIFEST)) await clearChunks(key);
        return;
      }

      const parts: string[] = [];
      for (let i = 0; i < token.length; i += CHUNK_SIZE) {
        parts.push(token.slice(i, i + CHUNK_SIZE));
      }
      // Chunks first, manifest last: a crash midway then leaves the old
      // value in place rather than a manifest pointing at nothing.
      for (let i = 0; i < parts.length; i++) {
        await SecureStore.setItemAsync(`${key}.${i}`, parts[i], OPTS);
      }
      await SecureStore.setItemAsync(key, `${MANIFEST}${parts.length}`, OPTS);
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
      await clearChunks(key);
    } catch {
      /* Best effort. */
    }
  },
};

/**
 * Does SecureStore actually work on this device?
 *
 * Worth asking outright, because every explanation left standing depends
 * on the answer and nothing so far has established it. Clerk's own logs
 * show the session created and never revoked, so the session is alive on
 * their side and the phone is losing it locally — which means either the
 * store is failing here, or it is fine and the fault is in how the SDK
 * uses it. Those need completely different fixes and look identical from
 * outside.
 *
 * Writes a value larger than SecureStore's 2048-byte limit through the
 * same chunked path a real token takes, reads it back, compares, and
 * cleans up. The result travels with the next tokenless request, so it
 * lands in a log the owner can read rather than a console nobody sees.
 */
let selfTestResult: string | null = null;

export function storageSelfTestResult(): string {
  return selfTestResult ?? "pending";
}

export async function runStorageSelfTest(): Promise<void> {
  if (selfTestResult !== null) return;
  const KEY = "__filmlocker_storage_selftest";
  // Comfortably over the limit, so this exercises chunking rather than
  // the easy path a short value would take.
  const sample = "x".repeat(3000);
  try {
    await chunkedTokenCache.saveToken(KEY, sample);
    const read = await chunkedTokenCache.getToken(KEY);
    if (read === null) selfTestResult = "readback-null";
    else if (read.length !== sample.length) selfTestResult = `truncated-${read.length}`;
    else if (read !== sample) selfTestResult = "corrupt";
    else selfTestResult = "ok";
    await chunkedTokenCache.clearToken(KEY);
  } catch (err) {
    selfTestResult = `threw:${err instanceof Error ? err.name : "unknown"}`;
  }
}
