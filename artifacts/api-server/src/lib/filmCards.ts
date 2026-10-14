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
import { fetchMovieDetails } from "./tmdb";

export interface FilmCard {
  tmdbId: number;
  title: string | null;
  posterUrl: string | null;
  releaseYear: string | null;
}

/**
 * Resolve every id given, keyed by tmdbId.
 *
 * An id that neither source can answer is simply absent from the map rather
 * than present-but-empty: callers decide whether a film they cannot
 * illustrate is worth showing, and for a list of someone's activity it is —
 * dropping the row would silently shorten the list and misrepresent how
 * active they have been.
 */
export async function resolveFilmCards(tmdbIds: number[]): Promise<Map<number, FilmCard>> {
  const wanted = [...new Set(tmdbIds)].filter((id) => Number.isInteger(id) && id > 0);
  const out = new Map<number, FilmCard>();
  if (wanted.length === 0) return out;

  const localRows = await db
    .select({
      tmdbId: moviesTable.tmdbId,
      title: moviesTable.title,
      posterUrl: moviesTable.posterUrl,
      releaseYear: moviesTable.releaseYear,
    })
    .from(moviesTable)
    .where(inArray(moviesTable.tmdbId, wanted));

  for (const row of localRows) {
    // First row wins; duplicates are the same film saved by other people.
    if (!out.has(row.tmdbId)) {
      out.set(row.tmdbId, {
        tmdbId: row.tmdbId,
        title: row.title,
        posterUrl: row.posterUrl || null,
        releaseYear: row.releaseYear || null,
      });
    }
  }

  const missing = wanted.filter((id) => !out.has(id));
  if (missing.length === 0) return out;

  // Bounded by the caller's own page size, and cached for half an hour, so
  // this is a handful of requests on a cold profile and none on a warm one.
  const fetched = await Promise.all(
    missing.map(async (tmdbId) => {
      try {
        const details = await fetchMovieDetails(tmdbId);
        return details ? { tmdbId, details } : null;
      } catch {
        // A film we cannot name is not a reason to fail the whole screen.
        return null;
      }
    })
  );

  for (const hit of fetched) {
    if (!hit) continue;
    out.set(hit.tmdbId, {
      tmdbId: hit.tmdbId,
      title: hit.details.title,
      posterUrl: hit.details.posterUrl || null,
      releaseYear: hit.details.releaseYear || null,
    });
  }

  return out;
}
