/**
 * Which of your films the "Recommended for You" rail is built from.
 *
 * The rail asks TMDB "what is like this?" about a handful of your films, so
 * what it shows is decided entirely by WHICH films it picks. Those are the
 * seeds, and this is how they are chosen.
 *
 * The rule it replaces was `1 + rating + (isWatched ? 2 : 0)`, with ties
 * broken by date added. That has a flaw that gets worse the longer somebody
 * uses the app: a watched five-star film scores 8 and a film you saved this
 * morning scores 1, so once five well-rated films are in the locker they own
 * the top five for good. Nothing you add can ever displace them, and since
 * TMDB's recommendations for a given film barely move, the rail then shows
 * the same twenty films forever — which is exactly what it was doing.
 *
 * So recency is no longer a tiebreak. It is a decay applied to the whole
 * score, which is what lets it dominate: a film that has not said anything
 * about your taste for months stops being used, however highly you rated it.
 */

/**
 * How long until a film counts for half as much.
 *
 * A month, because that is roughly the rhythm the rail is trying to follow —
 * what you have been watching and saving lately. Much shorter and a quiet
 * fortnight empties the rail of anything meaningful; much longer and it goes
 * back to being a monument to whatever you rated highest in year one.
 */
export const RECENCY_HALF_LIFE_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/** The fields of a locker film the seed choice actually reads. */
export interface SeedCandidate {
  tmdbId: number;
  rating: number | null;
  isWatched: boolean;
  watchedAt: Date | null;
  addedAt: Date;
}

/**
 * When this film last told us something about your taste.
 *
 * Watching something is the more recent act than saving it, so for a watched
 * film that is the date that counts. watchedAt is nullable — films marked
 * watched before the column existed have none — so it falls back to addedAt
 * rather than treating a missing date as the epoch, which would bury those
 * films permanently.
 */
function activeAt(film: SeedCandidate): Date {
  if (film.isWatched && film.watchedAt) return film.watchedAt;
  return film.addedAt;
}

/**
 * How much this film should steer the rail.
 *
 *   score = kind × rating × recency
 *
 * - kind: 2 for watched, 1 for on the watchlist. Having seen a film says
 *   twice as much as having meant to.
 * - rating: 1× unrated, up to 2× at five stars. A multiplier rather than
 *   something added, so it amplifies a recent opinion instead of granting
 *   an old one a permanent lead.
 * - recency: halves every RECENCY_HALF_LIFE_DAYS.
 *
 * The number itself is never served to anyone and has no meaning outside a
 * comparison with another film's. Exported so the ordering can be exercised
 * directly rather than only through a TMDB round trip.
 */
export function seedScore(film: SeedCandidate, now: Date): number {
  const kind = film.isWatched ? 2 : 1;
  const rating = film.rating ? 1 + film.rating / 5 : 1;

  // Clamped at zero so a clock skew that puts a row slightly in the future
  // cannot hand it a score above its weight.
  const ageDays = Math.max(0, (now.getTime() - activeAt(film).getTime()) / MS_PER_DAY);
  const recency = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);

  return kind * rating * recency;
}

/**
 * The films to ask TMDB about, best first.
 *
 * `limit` seeds, which is deliberately small: each one is a TMDB request,
 * and the pool they produce is already larger than the rail can show.
 *
 * Ties break on tmdbId rather than being left to the sort's own order. Every
 * score here is a float, so exact ties are rare — but a locker restored from
 * a backup can have a row of films sharing a timestamp, and a rail whose
 * order changes between two identical requests looks broken.
 */
export function pickSeeds<T extends SeedCandidate>(
  films: T[],
  limit: number,
  now: Date = new Date()
): T[] {
  return films
    .map((film) => ({ film, score: seedScore(film, now) }))
    .sort((a, b) => b.score - a.score || a.film.tmdbId - b.film.tmdbId)
    .slice(0, limit)
    .map((s) => s.film);
}
