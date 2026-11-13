import { useMemo } from 'react';
import { useListMovies, type Movie } from '@workspace/api-client-react';

/**
 * Every TMDB id this user has marked watched.
 *
 * A tick belongs on a film you have seen wherever that film appears —
 * trending, new releases, a recommendation, someone else's playlist —
 * and not only in the two tabs that happen to be built from your own
 * rows. Knowing you have seen something is most useful precisely where
 * you are being offered it again.
 *
 * One hook rather than a Set rebuilt per screen, because the query is
 * shared and cached: the second caller costs a lookup, not a request.
 */
export function useWatchedTmdbIds(): Set<number> {
  const { data } = useListMovies();
  return useMemo(
    () => new Set((data?.movies ?? []).filter((m) => m.isWatched).map((m) => m.tmdbId)),
    [data],
  );
}

/** Where a film sits in the viewer's locker, or null if it is not in it. */
export type LockerStatus = 'watchlist' | 'watched' | null;

/**
 * tmdbId → whether it is on the watchlist, watched, or neither.
 *
 * The wider version of useWatchedTmdbIds, for screens that offer BOTH
 * "save" and "mark watched" and so need to tell an unsaved film from one
 * already on the watchlist — a set of watched ids cannot answer that.
 *
 * Reads the same shared query, so a screen using both hooks still makes
 * one request.
 */
export function useLockerStatusByTmdbId(): Map<number, Exclude<LockerStatus, null>> {
  const { data } = useListMovies();
  return useMemo(
    () =>
      new Map(
        (data?.movies ?? []).map((m) => [m.tmdbId, m.isWatched ? 'watched' as const : 'watchlist' as const]),
      ),
    [data],
  );
}

/**
 * tmdbId → the viewer's whole locker row.
 *
 * For screens that do not only ask "is this saved" but act on it. Marking
 * something unwatched or removing it needs the row's own id, which a
 * status alone cannot give — the film's tmdbId is not what those
 * endpoints take.
 *
 * Same shared query again, so a screen using this and the status map
 * together still makes one request.
 */
export function useLockerByTmdbId(): Map<number, Movie> {
  const { data } = useListMovies();
  return useMemo(
    () => new Map((data?.movies ?? []).map((m) => [m.tmdbId, m])),
    [data],
  );
}

/**
 * Which of two statuses is further along, treating them as a one-way
 * progression: nothing → watchlist → watched.
 *
 * Used to reconcile what the server last said with what the viewer has
 * just tapped, where either can be ahead of the other. The tap is ahead
 * until the refetch lands; the server is ahead when the film was already
 * in the locker before this screen was opened. Taking the further of the
 * two is right in both directions, and neither action ever moves a film
 * backwards.
 */
export function furtherLockerStatus(a: LockerStatus, b: LockerStatus): LockerStatus {
  const rank = (s: LockerStatus) => (s === 'watched' ? 2 : s === 'watchlist' ? 1 : 0);
  return rank(a) >= rank(b) ? a : b;
}
