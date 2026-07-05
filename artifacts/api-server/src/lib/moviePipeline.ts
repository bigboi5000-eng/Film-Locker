/**
 * moviePipeline.ts
 *
 * Shared Gemini → TMDB → DB pipeline used by:
 *   - /movies/ai-extract         (text → Gemini → TMDB → DB)
 *   - /movies/process-social-link caption path  (text → Gemini → TMDB → DB)
 *   - /movies/process-social-link audio path    (Gemini already ran on audio
 *                                                → TMDB → DB only)
 *
 * Exported functions:
 *   enrichAndSaveMatches(rawMatches, warn?)  — TMDB + DB only (skip Gemini)
 *   runMoviePipeline(text, warn?)            — Gemini + TMDB + DB
 */

import { eq } from "drizzle-orm";
import { db, moviesTable } from "@workspace/db";
import { extractMoviesWithGemini, type GeminiMovieMatch } from "./geminiParser";
import { searchTmdb } from "./tmdb";

export type SavedMovie = typeof moviesTable.$inferSelect;

export interface EnrichedMatch {
  movie_title: string;
  release_year: string;
  confidence_score: number;
  tmdb_id: number | null;
}

export interface PipelineResult {
  matches: EnrichedMatch[];
  saved: SavedMovie[];
}

type WarnFn = (data: Record<string, unknown>, msg: string) => void;

/** Minimum Gemini confidence score to attempt a TMDB lookup and DB save. */
const CONFIDENCE_THRESHOLD = 0.45;

/**
 * TMDB enrichment + DB upsert for a pre-extracted list of movie matches.
 *
 * Call this when Gemini has already run (e.g. the audio extraction path)
 * and you just need to resolve TMDB IDs and persist to the locker.
 *
 * @param rawMatches  Matches from extractMoviesWithGemini (or extractMoviesFromAudio)
 * @param warn        Optional structured logger for per-match warnings
 */
export async function enrichAndSaveMatches(
  rawMatches: GeminiMovieMatch[],
  warn?: WarnFn
): Promise<PipelineResult> {
  // Sanitise and sort by confidence descending
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
    // Skip low-confidence matches — include in response but without tmdb_id
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

      enrichedMatches.push({ ...match, tmdb_id: hit.tmdbId });

      if (seenTmdb.has(hit.tmdbId)) continue;
      seenTmdb.add(hit.tmdbId);

      // Idempotent insert — unique index on tmdb_id
      const [movie] = await db
        .insert(moviesTable)
        .values({
          tmdbId: hit.tmdbId,
          title: hit.title,
          releaseYear: hit.releaseYear,
          posterUrl: hit.posterUrl,
          overview: hit.overview,
        })
        .onConflictDoNothing()
        .returning();

      if (movie) {
        saved.push(movie);
      } else {
        // Already in locker — fetch the existing row so the UI can display it
        const [existing] = await db
          .select()
          .from(moviesTable)
          .where(eq(moviesTable.tmdbId, hit.tmdbId));
        if (existing) saved.push(existing);
      }
    } catch (err) {
      warn?.({ match, err }, "pipeline: TMDB/DB step failed for match");
      enrichedMatches.push({ ...match, tmdb_id: null });
    }
  }

  return { matches: enrichedMatches, saved };
}

/**
 * Full text → Gemini → TMDB → DB pipeline.
 *
 * Use this when starting from raw text (caption, transcript, freeform prose).
 * Calls Gemini for structured extraction, then delegates to enrichAndSaveMatches.
 *
 * @param text  Raw text to analyse
 * @param warn  Optional structured logger
 */
export async function runMoviePipeline(
  text: string,
  warn?: WarnFn
): Promise<PipelineResult> {
  const rawMatches = await extractMoviesWithGemini(text);
  return enrichAndSaveMatches(rawMatches, warn);
}
