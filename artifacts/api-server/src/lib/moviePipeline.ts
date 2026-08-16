/**
 * moviePipeline.ts
 *
 * Shared Gemini → TMDB → DB pipeline.
 *
 * Exported functions:
 *   enrichAndSaveMatches(rawMatches, warn?)  — TMDB + DB only (Gemini already ran)
 *   runMoviePipeline(text, warn?)            — Gemini + TMDB + DB
 */

import { and, eq } from "drizzle-orm";
import { db, moviesTable } from "@workspace/db";
import { extractMoviesWithGemini, type GeminiMovieMatch } from "./geminiParser";
import { searchTmdb, fetchMovieDetails } from "./tmdb";

export type SavedMovie = typeof moviesTable.$inferSelect;

export interface EnrichedMatch {
  movie_title: string;
  release_year: string;
  confidence_score: number;
  tmdb_id: number | null;
  /** Populated in dry-run mode — TMDB card fields for UI display. */
  poster_url?: string | null;
  title?: string | null;
  overview?: string | null;
}

export interface PipelineResult {
  matches: EnrichedMatch[];
  saved: SavedMovie[];
  /** Suggested playlist name when the source was a curated/ranked list, null otherwise. */
  listTitle: string | null;
}

type WarnFn = (data: Record<string, unknown>, msg: string) => void;

const CONFIDENCE_THRESHOLD = 0.45;

/**
 * TMDB enrichment + DB upsert for a pre-extracted list of movie matches.
 *
 * Fetches full details (director, cast, genres, language, watch providers)
 * for each match and upserts into the DB — updating enrichment fields when
 * the row already exists so previously saved movies also get full metadata.
 *
 * @param dryRun  When true, look up TMDB data but skip all DB writes.
 *                Matches will include poster_url/title/overview for UI display.
 */
export async function enrichAndSaveMatches(
  rawMatches: GeminiMovieMatch[],
  warn?: WarnFn,
  dryRun = false,
  clerkUserId = "",
  listTitle: string | null = null
): Promise<PipelineResult> {
  const sanitised = rawMatches
    .map((m) => ({
      ...m,
      confidence_score: Number.isFinite(m.confidence_score)
        ? Math.min(1, Math.max(0, m.confidence_score))
        : 0,
    }))
    .sort((a, b) => b.confidence_score - a.confidence_score);

  const seenTmdb = new Set<number>();
  const saved: SavedMovie[] = [];
  const enrichedMatches: EnrichedMatch[] = [];

  for (const match of sanitised) {
    if (!(match.confidence_score >= CONFIDENCE_THRESHOLD)) {
      enrichedMatches.push({ ...match, tmdb_id: null });
      continue;
    }

    try {
      const hits = await searchTmdb(match.movie_title);
      const hit = hits[0];

      if (!hit) {
        enrichedMatches.push({ ...match, tmdb_id: null });
        continue;
      }

      // In dry-run mode include TMDB card data so the UI can show a film card
      // without a separate fetch.
      enrichedMatches.push({
        ...match,
        tmdb_id: hit.tmdbId,
        poster_url: hit.posterUrl,
        title: hit.title,
        overview: hit.overview,
      });

      if (seenTmdb.has(hit.tmdbId)) continue;
      seenTmdb.add(hit.tmdbId);

      // ── Skip all DB writes in dry-run mode ───────────────────────────────
      if (dryRun) continue;

      // Fetch full details (director, cast, genres, language, watch providers)
      const details = await fetchMovieDetails(hit.tmdbId).catch((err) => {
        warn?.({ err, tmdbId: hit.tmdbId }, "pipeline: fetchMovieDetails failed — using basic data");
        return null;
      });

      const values = {
        tmdbId: hit.tmdbId,
        clerkUserId,
        title: details?.title ?? hit.title,
        releaseYear: details?.releaseYear ?? hit.releaseYear,
        posterUrl: details?.posterUrl ?? hit.posterUrl,
        overview: details?.overview ?? hit.overview,
        director: details?.director ?? "",
        cast: details?.cast ?? [],
        genres: details?.genres ?? [],
        language: details?.language ?? "",
        watchProviders: details?.watchProviders ?? [],
      };

      // Upsert:
      //   - New row: insert with all enrichment data.
      //   - Existing row + fresh details: update enrichment fields only
      //     (never touch rating / isWatched / watchedAt).
      //   - Existing row + details fetch failed: do nothing so we don't
      //     regress existing metadata to empty strings/arrays.
      let movie: typeof moviesTable.$inferSelect | undefined;

      if (details) {
        ([movie] = await db
          .insert(moviesTable)
          .values(values)
          .onConflictDoUpdate({
            target: [moviesTable.tmdbId, moviesTable.clerkUserId],
            set: {
              director: values.director,
              cast: values.cast,
              genres: values.genres,
              language: values.language,
              watchProviders: values.watchProviders,
            },
          })
          .returning());
      } else {
        // details fetch failed — insert basic data; if already exists don't
        // overwrite enriched fields.  `.onConflictDoNothing().returning()`
        // returns nothing when the row already exists, so fall back to a
        // SELECT to guarantee the movie still appears in `saved`.
        ([movie] = await db
          .insert(moviesTable)
          .values(values)
          .onConflictDoNothing()
          .returning());

        if (!movie) {
          ([movie] = await db
            .select()
            .from(moviesTable)
            .where(
              and(
                eq(moviesTable.tmdbId, hit.tmdbId),
                eq(moviesTable.clerkUserId, clerkUserId),
              )
            )
            .limit(1));
        }
      }

      if (movie) saved.push(movie);
    } catch (err) {
      warn?.({ match, err }, "pipeline: TMDB/DB step failed for match");
      enrichedMatches.push({ ...match, tmdb_id: null });
    }
  }

  return { matches: enrichedMatches, saved, listTitle };
}

/**
 * Full text → Gemini → TMDB → DB pipeline.
 */
export async function runMoviePipeline(
  text: string,
  warn?: WarnFn,
  dryRun = false,
  clerkUserId = ""
): Promise<PipelineResult> {
  const { movies: rawMatches, list_title: listTitle } = await extractMoviesWithGemini(text);
  return enrichAndSaveMatches(rawMatches, warn, dryRun, clerkUserId, listTitle);
}
