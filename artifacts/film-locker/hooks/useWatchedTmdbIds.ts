import { useMemo } from 'react';
import { useListMovies } from '@workspace/api-client-react';

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
