/**
 * moviePipeline.ts
 *
 * Shared Gemini → TMDB → DB pipeline used by both /movies/ai-extract and
 * /movies/process-social-link. Keeps the two routes DRY.
 *
 * Steps:
 *   1. extractMoviesWithGemini(text)  — structured extraction with confidence scores
 *   2. Sanitise / sort confidence scores
 *   3. For each match above the threshold: searchTmdb → insert or select from DB
 *
 * Returns enriched matches (with resolved tmdb_id) and the list of saved Movie rows.
 */

import { eq } from "drizzle-orm";
import { db, moviesTable } from "@workspace/db";
import { extractMoviesWithGemini } from "./geminiParser";
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

/** Minimum Gemini confidence score to attempt a TMDB lookup and DB save. */
const CONFIDENCE_THRESHOLD = 0.45;

/**
 * Run the full Gemini → TMDB → DB pipeline on a block of text.
 *
 * @param text    Raw text to analyse (caption, transcript, freeform, etc.)
 * @param warn    Optional logger to emit per-match warnings without aborting the loop.
 */
export async function runMoviePipeline(
  text: string,
  warn?: (data: Record<string, unknown>, msg: string) => void
): Promise<PipelineResult> {
  // 1. Gemini structured extraction
  let rawMatches = await extractMoviesWithGemini(text);

  // Sanitise: guard against NaN / non-finite values from the model
  rawMatches = rawMatches.map((m) => ({
    ...m,
    confidence_score: Number.isFinite(m.confidence_score)
      ? Math.min(1, Math.max(0, m.confidence_score))
      : 0,
  }));

  // Sort highest confidence first
  rawMatches.sort((a, b) => b.confidence_score - a.confidence_score);

  // 2. TMDB enrichment + DB upsert
  const seenTmdb = new Set<number>();
  const saved: SavedMovie[] = [];
  const enrichedMatches: EnrichedMatch[] = [];

  for (const match of rawMatches) {
    // Skip low-confidence matches — still include them in the response, just without tmdb_id
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
