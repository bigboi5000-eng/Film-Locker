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
  /** Carried through from the raw match — only recommend results set this. */
  synopsis?: string | null;
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
 * How many TMDB requests to have in flight at once.
 *
 * A "Top 10" share arrives as ten titles, and looking them up one after
 * another made the wait scale linearly with list length — the dominant cost
 * once Gemini had already answered. TMDB's own limit is far above this;
 * the cap is here to stay a considerate client, not because it's the
 * bottleneck.
 */
const TMDB_CONCURRENCY = 8;

/**
 * Like `items.map(fn)` awaited in parallel, but with at most `limit` calls
 * in flight. Results stay in input order regardless of completion order.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });

  await Promise.all(workers);
  return results;
}

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

  // ── Pass 1: TMDB lookups, in parallel ──────────────────────────────────
  // Index-aligned with `sanitised`; null means "no usable TMDB match", either
  // because the match was below the confidence threshold, the search found
  // nothing, or the search itself failed.
  const hits = await mapWithConcurrency(sanitised, TMDB_CONCURRENCY, async (match) => {
    if (!(match.confidence_score >= CONFIDENCE_THRESHOLD)) return null;
    try {
      return (await searchTmdb(match.movie_title))[0] ?? null;
    } catch (err) {
      warn?.({ match, err }, "pipeline: TMDB search failed for match");
      return null;
    }
  });

  // ── Pass 2: assemble matches in order, and pick out what to save ────────
  // Sequential and cheap (no I/O), so result ordering and de-duplication stay
  // exactly as before — highest confidence first, first occurrence of a given
  // TMDB id wins.
  const seenTmdb = new Set<number>();
  const enrichedMatches: EnrichedMatch[] = [];
  const toSave: NonNullable<(typeof hits)[number]>[] = [];

  sanitised.forEach((match, i) => {
    const hit = hits[i];

    if (!hit) {
      enrichedMatches.push({ ...match, tmdb_id: null });
      return;
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

    if (seenTmdb.has(hit.tmdbId)) return;
    seenTmdb.add(hit.tmdbId);
    toSave.push(hit);
  });

  // ── Skip all DB writes in dry-run mode ─────────────────────────────────
  if (dryRun) {
    return { matches: enrichedMatches, saved: [], listTitle };
  }

  // ── Pass 3: details fetch + upsert per film, also in parallel ───────────
  // Note a deliberate difference from the previous sequential version: a
  // failure here leaves the film in `matches` with its TMDB id, and only
  // absent from `saved`. Identification did succeed — it was the write that
  // didn't — so reporting the film as unidentified would be wrong.
  const savedOrNull = await mapWithConcurrency(toSave, TMDB_CONCURRENCY, async (hit) => {
    try {
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
      let movie: SavedMovie | undefined;

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

      return movie ?? null;
    } catch (err) {
      warn?.({ tmdbId: hit.tmdbId, err }, "pipeline: save step failed for match");
      return null;
    }
  });

  const saved = savedOrNull.filter((m): m is SavedMovie => m !== null);

  return { matches: enrichedMatches, saved, listTitle };
}

/**
 * Full text → Gemini → TMDB → DB pipeline.
 *
 * @param treatAsLiteralTitle  Set when `text` is already believed to be a
 *   literal film title rather than freeform caption/prose — a mixed-text
 *   share's title hint, or a search engine's own `q=` query string. In that
 *   case, if Gemini's freeform-text extraction doesn't recognize `text` as a
 *   film reference (common for a short or ambiguous title with zero
 *   surrounding context — a single word that's also an everyday English
 *   word, e.g. "Hokum" — where an unambiguous title like "Schindler's List"
 *   would still be recognized fine), fall back to searching TMDB directly
 *   for `text` rather than giving up. Left false for genuine freeform text
 *   (e.g. a full scraped caption), where blindly TMDB-searching the whole
 *   string could turn up an unrelated false-positive match.
 */
export async function runMoviePipeline(
  text: string,
  warn?: WarnFn,
  dryRun = false,
  clerkUserId = "",
  treatAsLiteralTitle = false
): Promise<PipelineResult> {
  const { movies: rawMatches, list_title: listTitle } = await extractMoviesWithGemini(text);

  if (rawMatches.length === 0 && treatAsLiteralTitle) {
    const hits = await searchTmdb(text).catch(() => []);
    const hit = hits[0];
    if (hit) {
      warn?.({ text, tmdbId: hit.tmdbId }, "pipeline: Gemini found no reference — direct TMDB search matched");
      return enrichAndSaveMatches(
        [{ movie_title: hit.title, release_year: hit.releaseYear, confidence_score: 1 }],
        warn,
        dryRun,
        clerkUserId,
        null
      );
    }
  }

  return enrichAndSaveMatches(rawMatches, warn, dryRun, clerkUserId, listTitle);
}
