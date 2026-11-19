/**
 * moviePipeline.ts
 *
 * Shared Gemini → TMDB → DB pipeline.
 *
 * Exported functions:
 *   enrichAndSaveMatches(rawMatches, warn?)  — TMDB + DB only (Gemini already ran)
 *   runMoviePipeline(text, warn?)            — Gemini + TMDB + DB
 */

import { and, eq, sql } from "drizzle-orm";
import { db, moviesTable } from "@workspace/db";
import { extractMoviesWithGemini, type GeminiMovieMatch } from "./geminiParser";
import {
  searchTmdb,
  searchTmdbPreferringYear,
  searchTmdbTv,
  fetchMovieDetails,
  DEFAULT_REGION,
  type MediaType,
} from "./tmdb";

export type SavedMovie = typeof moviesTable.$inferSelect;

export interface EnrichedMatch {
  movie_title: string;
  release_year: string;
  confidence_score: number;
  tmdb_id: number | null;
  /**
   * Which of TMDB's two id spaces tmdb_id belongs to.
   *
   * Not simply carried over from what Gemini said: the lookup falls back
   * to the other space on a miss, so this is what TMDB actually matched.
   * Absent when nothing matched, and absent means film for any client that
   * does not read it.
   */
  media_type?: MediaType;
  /** Populated in dry-run mode — TMDB card fields for UI display. */
  poster_url?: string | null;
  title?: string | null;
  overview?: string | null;
  /** Carried through from the raw match — only recommend results set this. */
  synopsis?: string | null;
  /**
   * Carried through from the raw match — only the image path sets this.
   * "imagery" marks a film nobody named, which the model recognised from
   * the picture. See GeminiMovieMatch for why it matters.
   */
  identified_from?: "text" | "imagery";
  /**
   * Set when the title matched no film but does match a television series.
   *
   * Only ever populated for an app build that cannot save a series. A build
   * that can gets the series itself, as an ordinary match with a tmdb_id
   * and media_type: "tv". Kept, rather than removed with television
   * support, because an older build still reads it — and reads nothing
   * else that would let it say anything useful about a series.
   */
  tv_series_name?: string | null;
  tv_series_year?: string | null;
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
 * Below this, a title that matched no film is not looked up as television
 * either.
 *
 * It sits under CONFIDENCE_THRESHOLD on purpose. A clip from a miniseries
 * scores low precisely *because* the extractor is told to exclude
 * television, so requiring the film threshold would rule out the exact case
 * this is for — "Houdini" came back at 0.4. But a title Gemini half-invented
 * from a figure of speech scores lower still, and running that against
 * TMDB's TV index would confidently name a series nobody mentioned.
 */
const TV_CHECK_FLOOR = 0.3;

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
 * The most films one share will be worked through.
 *
 * Every film past this point is two TMDB round trips and a row, so an
 * uncapped "top 2000" post is not a long wait but an open-ended one, and
 * the whole request sits behind a deadline the client enforces. Fifteen
 * hundred is comfortably past any real list — the biggest things people
 * share are top-1000 countdowns — while still being a number rather than
 * no number at all.
 *
 * Taken off the top of a confidence sort, so a cut keeps the films most
 * likely to be right.
 */
const MAX_FILMS_PER_RUN = 1500;

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
/**
 * Everything about the save that is not a match. An object rather than yet
 * more positional arguments: this function already takes four, and the next
 * one along would be the fifth thing nobody can read at a call site.
 */
export interface SaveOptions {
  /**
   * The social post the films were extracted from, kept so the app can
   * offer a way back to it. Omitted by callers that have no post — the
   * camera, a search, an AI extraction from typed text.
   */
  sourceUrl?: string | null;
  /**
   * Whether the app build that asked can show a television series.
   *
   * Defaults to false, and that default is the safe one: an old build
   * handed a series saves it as a film under an id that belongs to
   * something else (see lib/clientCapabilities.ts). When false this
   * behaves exactly as it did before series were allowed in — a series is
   * not saved, and comes back as the `tv_series_name` explanation so the
   * user is told what it is instead of being shown an empty sheet.
   */
  supportsTv?: boolean;
}

export async function enrichAndSaveMatches(
  rawMatches: GeminiMovieMatch[],
  warn?: WarnFn,
  dryRun = false,
  clerkUserId = "",
  listTitle: string | null = null,
  options: SaveOptions = {}
): Promise<PipelineResult> {
  const sanitised = rawMatches
    .map((m) => ({
      ...m,
      confidence_score: Number.isFinite(m.confidence_score)
        ? Math.min(1, Math.max(0, m.confidence_score))
        : 0,
    }))
    .sort((a, b) => b.confidence_score - a.confidence_score)
    // Sorted before it is cut, so what survives a cut is the most confident
    // rather than whatever happened to be listed first.
    .slice(0, MAX_FILMS_PER_RUN);

  if (rawMatches.length > MAX_FILMS_PER_RUN) {
    warn?.(
      { named: rawMatches.length, kept: MAX_FILMS_PER_RUN },
      "pipeline: more films named than the cap allows — keeping the most confident",
    );
  }

  // ── Pass 1: TMDB lookups, in parallel ──────────────────────────────────
  // Index-aligned with `sanitised`; null means "no usable TMDB match", either
  // because the match was below the confidence threshold, the search found
  // nothing, or the search itself failed.
  const supportsTv = options.supportsTv ?? false;

  const hits = await mapWithConcurrency(sanitised, TMDB_CONCURRENCY, async (match) => {
    if (!(match.confidence_score >= CONFIDENCE_THRESHOLD)) return null;

    // Which of TMDB's two id spaces to look in. Gemini is asked outright,
    // because the kind cannot be recovered afterwards: "Fargo" resolves in
    // both, and picking by popularity gets it wrong about half the time.
    //
    // When the client cannot show television this stays "movie" whatever
    // Gemini said, which keeps the old behaviour exactly — the series is
    // not found as a film, and pass 1b below explains why.
    const wanted: MediaType = supportsTv && match.media_type === "tv" ? "tv" : "movie";

    try {
      // Gemini's release_year disambiguates remakes and same-titled films,
      // and is what keeps a brand-new release from losing to a better-known
      // older one. It falls back to an unnarrowed search when the year finds
      // nothing, so a wrong year costs a little latency, never a match.
      const primary = await searchTmdbPreferringYear(
        match.movie_title,
        match.release_year,
        wanted,
      );
      if (primary[0]) return primary[0];

      // Gemini can call it wrong — a film spun off a series, a series
      // named after a film. A miss in one space is worth one look in the
      // other before giving up, and only ever on a miss, so the ordinary
      // path costs nothing.
      if (!supportsTv) return null;
      const other: MediaType = wanted === "tv" ? "movie" : "tv";
      return (
        (await searchTmdbPreferringYear(match.movie_title, match.release_year, other))[0] ??
        null
      );
    } catch (err) {
      warn?.({ match, err }, "pipeline: TMDB search failed for match");
      return null;
    }
  });

  // ── Pass 1b: for anything that found no film, ask whether it is TV ──────
  // Only for the misses, so the ordinary path costs nothing extra, and
  // index-aligned with `sanitised` the same way `hits` is — the entries are
  // mapped rather than the matches because mapWithConcurrency hands the
  // callback an item and not its position.
  const tvHits = await mapWithConcurrency(
    sanitised.map((match, i) => ({ match, i })),
    TMDB_CONCURRENCY,
    async ({ match, i }) => {
      if (hits[i]) return null; // something was found; nothing needs explaining
      // A build that CAN save a series has already had one looked for
      // above and found nothing, so there is nothing left to explain.
      if (supportsTv) return null;
      if (match.confidence_score < TV_CHECK_FLOOR) return null;
      try {
        return await searchTmdbTv(match.movie_title, match.release_year);
      } catch (err) {
        // A failure here costs a better error message, nothing more.
        warn?.({ match, err }, "pipeline: TMDB TV search failed for unmatched title");
        return null;
      }
    },
  );

  // ── Pass 2: assemble matches in order, and pick out what to save ────────
  // Sequential and cheap (no I/O), so result ordering and de-duplication stay
  // exactly as before — highest confidence first, first occurrence of a given
  // TMDB id wins.
  const seenTmdb = new Set<string>();
  const enrichedMatches: EnrichedMatch[] = [];
  const toSave: NonNullable<(typeof hits)[number]>[] = [];

  sanitised.forEach((match, i) => {
    const hit = hits[i];

    if (!hit) {
      const tv = tvHits[i];
      enrichedMatches.push({
        ...match,
        tmdb_id: null,
        tv_series_name: tv?.name ?? null,
        tv_series_year: tv?.firstAirYear ?? null,
      });
      return;
    }

    // In dry-run mode include TMDB card data so the UI can show a film card
    // without a separate fetch.
    enrichedMatches.push({
      ...match,
      tmdb_id: hit.tmdbId,
      // What TMDB actually matched, which is not always what Gemini said —
      // the fallback search above may have found it in the other space.
      media_type: hit.mediaType,
      poster_url: hit.posterUrl,
      title: hit.title,
      overview: hit.overview,
    });

    // Keyed by kind and id: a post naming both a film and the series made
    // from it is two titles, and on the id alone one of them vanishes.
    const key = `${hit.mediaType}:${hit.tmdbId}`;
    if (seenTmdb.has(key)) return;
    seenTmdb.add(key);
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
      const details = await fetchMovieDetails(hit.tmdbId, DEFAULT_REGION, hit.mediaType).catch(
        (err) => {
          warn?.(
            { err, tmdbId: hit.tmdbId, mediaType: hit.mediaType },
            "pipeline: fetchMovieDetails failed — using basic data",
          );
          return null;
        },
      );

      const values = {
        tmdbId: hit.tmdbId,
        mediaType: hit.mediaType,
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
        // Left null rather than 0 when details are unavailable: the column
        // distinguishes "not enriched yet" from a real length, and the
        // length filter treats null as unknown rather than very short.
        runtime: details?.runtime ?? null,
        tmdbRating: details?.tmdbRating ?? null,
        // Stamped only when TMDB actually answered, so the background
        // backfill picks up the rows where it did not and leaves alone the
        // ones it did. A null tmdbRating from a real answer is a film with no
        // votes, which is settled; a null from a failed fetch is not.
        enrichedAt: details ? new Date() : null,
        sourceUrl: options.sourceUrl ?? null,
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
            // Matches the unique index, which includes media_type. Without
            // it this would claim a conflict target Postgres has no index
            // for and the statement would simply error.
            target: [moviesTable.tmdbId, moviesTable.clerkUserId, moviesTable.mediaType],
            set: {
              director: values.director,
              cast: values.cast,
              genres: values.genres,
              language: values.language,
              watchProviders: values.watchProviders,
              runtime: values.runtime,
              tmdbRating: values.tmdbRating,
              enrichedAt: values.enrichedAt,
              // The FIRST post this film arrived from, not the latest. In
              // an ON CONFLICT SET clause an unqualified column is the
              // existing row, so this keeps whatever is already there and
              // only fills in a null. "The original post" means the one
              // that made you save it; seeing the same film again later
              // does not rewrite that.
              sourceUrl: sql`coalesce(${moviesTable.sourceUrl}, ${values.sourceUrl ?? null})`,
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
                eq(moviesTable.mediaType, hit.mediaType),
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
  treatAsLiteralTitle = false,
  options: SaveOptions = {}
): Promise<PipelineResult> {
  const { movies: rawMatches, list_title: listTitle } = await extractMoviesWithGemini(text);

  if (rawMatches.length === 0 && treatAsLiteralTitle) {
    // Films first, then series — and only for a client that can save one.
    // A title Gemini could not place is as likely to be a series as a
    // film, and "Chernobyl" pasted in plain text found nothing at all
    // before this.
    let hit = (await searchTmdb(text).catch(() => []))[0];
    if (!hit && options.supportsTv) {
      hit = (await searchTmdb(text, undefined, "tv").catch(() => []))[0];
    }
    if (hit) {
      warn?.(
        { text, tmdbId: hit.tmdbId, mediaType: hit.mediaType },
        "pipeline: Gemini found no reference — direct TMDB search matched",
      );
      return enrichAndSaveMatches(
        [
          {
            movie_title: hit.title,
            release_year: hit.releaseYear,
            confidence_score: 1,
            media_type: hit.mediaType,
          },
        ],
        warn,
        dryRun,
        clerkUserId,
        null,
        options
      );
    }
  }

  return enrichAndSaveMatches(rawMatches, warn, dryRun, clerkUserId, listTitle, options);
}
