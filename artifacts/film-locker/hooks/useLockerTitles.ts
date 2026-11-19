import { useMemo } from 'react';
import { useListMovies, type Movie } from '@workspace/api-client-react';

/**
 * What identifies a title.
 *
 * NOT the tmdbId on its own. TMDB numbers films and series in separate
 * sequences, so 1399 is both a Star Trek film and Game of Thrones — and a
 * map keyed on the id alone would put a tick on one because you have seen
 * the other.
 *
 * `mediaType` is absent on anything saved before series existed, and on
 * any response field an older build never set, which is why it is
 * optional and why absent reads as a film.
 */
export interface TitleRef {
  tmdbId: number;
  mediaType?: string | null;
}

/** Film or series, as the rest of the app spells it. */
export type MediaType = 'movie' | 'tv';

/**
 * Narrow whatever the server sent to one of the two kinds.
 *
 * The field is `string | null | undefined` on every generated type,
 * because the schema leaves it optional for rows and app builds that
 * predate television — all of which meant a film. So anything that is not
 * the literal "tv" is one, and this is the single place that decides it
 * rather than a `?? 'movie'` repeated at thirty call sites, each of which
 * would also have to be cast.
 */
export function asMediaType(value: string | null | undefined): MediaType {
  return value === 'tv' ? 'tv' : 'movie';
}

/** The key every locker map in this file is built on. */
export function titleKey(ref: TitleRef): string {
  return `${asMediaType(ref.mediaType)}:${ref.tmdbId}`;
}

/**
 * Every title this user has marked watched, keyed by `titleKey`.
 *
 * A tick belongs on something you have seen wherever it appears —
 * trending, new releases, a recommendation, someone else's playlist —
 * and not only in the two tabs that happen to be built from your own
 * rows. Knowing you have seen something is most useful precisely where
 * you are being offered it again.
 *
 * One hook rather than a Set rebuilt per screen, because the query is
 * shared and cached: the second caller costs a lookup, not a request.
 */
export function useWatchedTitles(): Set<string> {
  const { data } = useListMovies();
  return useMemo(
    () => new Set((data?.movies ?? []).filter((m) => m.isWatched).map(titleKey)),
    [data],
  );
}

/** Where a title sits in the viewer's locker, or null if it is not in it. */
export type LockerStatus = 'watchlist' | 'watched' | null;

/**
 * `titleKey` → whether it is on the watchlist, watched, or neither.
 *
 * The wider version of useWatchedTitles, for screens that offer BOTH
 * "save" and "mark watched" and so need to tell an unsaved title from one
 * already on the watchlist — a set of watched ids cannot answer that.
 *
 * Reads the same shared query, so a screen using both hooks still makes
 * one request.
 */
export function useLockerStatusByTitle(): Map<string, Exclude<LockerStatus, null>> {
  const { data } = useListMovies();
  return useMemo(
    () =>
      new Map(
        (data?.movies ?? []).map((m) => [
          titleKey(m),
          m.isWatched ? ('watched' as const) : ('watchlist' as const),
        ]),
      ),
    [data],
  );
}

/**
 * `titleKey` → the viewer's whole locker row.
 *
 * For screens that do not only ask "is this saved" but act on it. Marking
 * something unwatched or removing it needs the row's own id, which a
 * status alone cannot give — the title's tmdbId is not what those
 * endpoints take.
 *
 * Same shared query again, so a screen using this and the status map
 * together still makes one request.
 */
export function useLockerByTitle(): Map<string, Movie> {
  const { data } = useListMovies();
  return useMemo(
    () => new Map((data?.movies ?? []).map((m) => [titleKey(m), m])),
    [data],
  );
}

/**
 * Which of two statuses is further along, treating them as a one-way
 * progression: nothing → watchlist → watched.
 *
 * Used to reconcile what the server last said with what the viewer has
 * just tapped, where either can be ahead of the other. The tap is ahead
 * until the refetch lands; the server is ahead when the title was already
 * in the locker before this screen was opened. Taking the further of the
 * two is right in both directions, and neither action ever moves a title
 * backwards.
 */
export function furtherLockerStatus(a: LockerStatus, b: LockerStatus): LockerStatus {
  const rank = (s: LockerStatus) => (s === 'watched' ? 2 : s === 'watchlist' ? 1 : 0);
  return rank(a) >= rank(b) ? a : b;
}
