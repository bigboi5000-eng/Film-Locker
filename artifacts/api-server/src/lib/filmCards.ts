/**
 * filmCards.ts
 *
 * Turn a set of TMDB ids into something you can draw.
 *
 * Several tables record what somebody did to a film and keep only its TMDB
 * id: film_community_ratings and film_comments both do. Nothing in either
 * row says what the film is called or where its poster is, so any screen
 * that lists them — a profile's recent ratings, a feed of what your Film
 * Pals have been saying — has to resolve the ids first.
 *
 * Two sources, cheapest first. The movies table already holds TMDB metadata
 * for every film anybody has saved, and although its rows are per-user the
 * metadata on them is not: title, poster and year for a given tmdb_id are
 * the same whoever saved it. So one query over that table answers almost
 * everything, because people overwhelmingly rate and discuss films they
 * have also saved. Whatever is left falls back to TMDB itself, through the
 * same cached fetchMovieDetails the rest of the server uses.
 */
import { inArray } from "drizzle-orm";
import { db, moviesTable } from "@workspace/db";
import { fetchMovieDetails, normalizeMediaType, DEFAULT_REGION, type MediaType } from "./tmdb";

export interface FilmCard {
  tmdbId: number;
  mediaType: MediaType;
  title: string | null;
  posterUrl: string | null;
  releaseYear: string | null;
}

/** What a caller knows about a title before it has been resolved. */
export interface FilmCardRef {
  tmdbId: number;
  mediaType?: string | null;
}

/**
 * The map key.
 *
 * A bare tmdb_id is not a title: TMDB numbers films and series separately,
 * so 1399 is a Star Trek film and also Game of Thrones. Keyed on the id
 * alone, a feed showing both would draw one of them twice.
 */
export function filmCardKey(ref: FilmCardRef): string {
  return `${normalizeMediaType(ref.mediaType)}:${ref.tmdbId}`;
}

/**
 * Resolve every title given, keyed by `filmCardKey` — NOT by tmdbId.
 *
 * An id that neither source can answer is simply absent from the map rather
 * than present-but-empty: callers decide whether a film they cannot
 * illustrate is worth showing, and for a list of someone's activity it is —
 * dropping the row would silently shorten the list and misrepresent how
 * active they have been.
 */
export async function resolveFilmCards(
  refs: FilmCardRef[],
): Promise<Map<string, FilmCard>> {
  const out = new Map<string, FilmCard>();

  const wanted = new Map<string, { tmdbId: number; mediaType: MediaType }>();
  for (const ref of refs) {
    if (!Number.isInteger(ref.tmdbId) || ref.tmdbId <= 0) continue;
    wanted.set(filmCardKey(ref), {
      tmdbId: ref.tmdbId,
      mediaType: normalizeMediaType(ref.mediaType),
    });
  }
  if (wanted.size === 0) return out;

  // Narrowed by id only and then matched on the kind in JS. A tuple IN
  // would be exact, but the ids are already a short page's worth and the
  // extra rows this pulls back are a film and a series that happen to
  // share a number — a handful at most, thrown away immediately below.
  const localRows = await db
    .select({
      tmdbId: moviesTable.tmdbId,
      mediaType: moviesTable.mediaType,
      title: moviesTable.title,
      posterUrl: moviesTable.posterUrl,
      releaseYear: moviesTable.releaseYear,
    })
    .from(moviesTable)
    .where(inArray(moviesTable.tmdbId, [...wanted.values()].map((w) => w.tmdbId)));

  for (const row of localRows) {
    const k = filmCardKey(row);
    // First row wins; duplicates are the same title saved by other people.
    if (wanted.has(k) && !out.has(k)) {
      out.set(k, {
        tmdbId: row.tmdbId,
        mediaType: normalizeMediaType(row.mediaType),
        title: row.title,
        posterUrl: row.posterUrl || null,
        releaseYear: row.releaseYear || null,
      });
    }
  }

  const missing = [...wanted.entries()].filter(([k]) => !out.has(k));
  if (missing.length === 0) return out;

  // Bounded by the caller's own page size, and cached for half an hour, so
  // this is a handful of requests on a cold profile and none on a warm one.
  const fetched = await Promise.all(
    missing.map(async ([k, { tmdbId, mediaType }]) => {
      try {
        const details = await fetchMovieDetails(tmdbId, DEFAULT_REGION, mediaType);
        return details ? { k, tmdbId, mediaType, details } : null;
      } catch {
        // A title we cannot name is not a reason to fail the whole screen.
        return null;
      }
    })
  );

  for (const hit of fetched) {
    if (!hit) continue;
    out.set(hit.k, {
      tmdbId: hit.tmdbId,
      mediaType: hit.mediaType,
      title: hit.details.title,
      posterUrl: hit.details.posterUrl || null,
      releaseYear: hit.details.releaseYear || null,
    });
  }

  return out;
}
