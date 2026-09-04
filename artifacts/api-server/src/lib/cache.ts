/**
 * Tiny in-memory TTL cache with in-flight de-duplication. Not shared across
 * instances if this ever runs autoscaled — each instance caches its own
 * copy — but that's still a large reduction in upstream calls for data that
 * doesn't vary per user (trending/new-releases, TMDB lookups), with zero new
 * infrastructure. Not meant for anything per-user or security-sensitive.
 *
 * Entry count is capped: keys derived from user input (a TMDB search string)
 * would otherwise let the map grow without bound, one entry per distinct
 * query anyone ever types.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Upper bound on live entries. Comfortably more than the working set of
 * films this app looks up repeatedly, and small enough that the whole map
 * stays trivial next to a video download.
 */
const MAX_ENTRIES = 500;

const store = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Drop expired entries, then — if still over the cap — the oldest-inserted
 * ones. Map iterates in insertion order, so the eviction order is FIFO
 * rather than true LRU; for this workload (a burst of lookups around each
 * share, all of similar value) the difference isn't worth tracking access
 * times for.
 */
function evictIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return;

  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }

  for (const key of store.keys()) {
    if (store.size <= MAX_ENTRIES) break;
    store.delete(key);
  }
}

export interface CacheOptions<T> {
  /**
   * Decides whether a freshly fetched value is worth storing. Use it to keep
   * "found nothing" out of the cache, so a film that TMDB hasn't indexed yet
   * isn't remembered as missing for the rest of the TTL.
   */
  shouldCache?: (value: T) => boolean;
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  options: CacheOptions<T> = {},
): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fetcher()
    .then((value) => {
      if (options.shouldCache?.(value) ?? true) {
        store.set(key, { value, expiresAt: Date.now() + ttlMs });
        evictIfNeeded();
      }
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}
