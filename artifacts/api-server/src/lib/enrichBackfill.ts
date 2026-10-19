/**
 * Filling in TMDB metadata for films already in the database.
 *
 * Enrichment normally happens once, when a film is first saved. Columns added
 * later — `runtime`, then `tmdb_rating` in migration 0013 — therefore start
 * null on every row that predates them, and no amount of using the app fills
 * them in: nothing re-visits a film that is already saved. A rating filter
 * reading `tmdb_rating` over a table of nulls filters out everything.
 *
 * Backfilling inside the migration was rejected for the obvious reason (a
 * TMDB request per row, blocking the container from starting), so it lives
 * here and runs in the background after the server is already serving.
 *
 * Two things make this safe to run unattended on every boot:
 *
 *  - It is keyed on `enriched_at`, not on the nullable columns themselves.
 *    A film with no TMDB votes has a null `tmdb_rating` for ever, so a
 *    backfill keyed on null would re-fetch it on every start until the end of
 *    time. `enriched_at` records the visit rather than its result, so every
 *    row is fetched at most once and the work converges to nothing.
 *  - It is bounded and paced, so the worst case on a cold deploy is a slow
 *    trickle of requests rather than a thousand at once.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, moviesTable } from "@workspace/db";
import { fetchMovieDetails } from "./tmdb";
import { logger as rootLogger } from "./logger";

/** Pared-back logger interface, so the route can pass its request logger. */
export interface BackfillLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
}

export interface BackfillOptions {
  /**
   * Most distinct films to visit in one run. A cap rather than a page: what
   * is left over is picked up by the next run, because every successful visit
   * removes a film from the queue permanently.
   */
  limit?: number;
  /** Pause between TMDB fetches. Politeness, not a rate limit we are near. */
  spacingMs?: number;
  /** Restrict to one owner's rows, for the per-user route. */
  clerkUserId?: string;
  logger?: BackfillLogger;
}

export interface BackfillResult {
  /** Distinct films considered in this run. */
  films: number;
  /** Films TMDB answered for. */
  enriched: number;
  /** Films TMDB did not answer for; left for a later run. */
  failed: number;
  /** Rows written — higher than `enriched`, since several people own a film. */
  rows: number;
  /** Whether the cap was reached, i.e. there is more to do. */
  more: boolean;
}

/**
 * Films still needing a visit, one row per distinct TMDB id.
 *
 * Grouped rather than listed because `movies` is per-owner: the same film is
 * a separate row for every person who has saved it, and they would otherwise
 * be a separate TMDB request each. Grouping turns a locker shared by ten
 * people into one fetch and ten updates.
 *
 * `enriched_at IS NULL` is the gate, but the `OR` list still matters — it is
 * what stops the first run after the migration from re-fetching the entire
 * table. Only rows actually missing something are collected; a row with
 * nothing missing is simply left alone, null `enriched_at` and all.
 */
async function filmsNeedingVisit(limit: number, clerkUserId?: string): Promise<number[]> {
  const missing = sql`(
    array_length(${moviesTable.genres}, 1) IS NULL
    OR ${moviesTable.runtime} IS NULL
    OR ${moviesTable.tmdbRating} IS NULL
  )`;

  const rows = await db
    .select({ tmdbId: moviesTable.tmdbId, oldest: sql<string>`min(${moviesTable.addedAt})` })
    .from(moviesTable)
    .where(
      clerkUserId
        ? and(isNull(moviesTable.enrichedAt), missing, eq(moviesTable.clerkUserId, clerkUserId))
        : and(isNull(moviesTable.enrichedAt), missing),
    )
    .groupBy(moviesTable.tmdbId)
    // Oldest first, so a run that hits the cap makes deterministic progress
    // instead of revisiting whichever films the planner happened to return.
    .orderBy(asc(sql`min(${moviesTable.addedAt})`))
    .limit(limit);

  return rows.map((r) => r.tmdbId);
}

/**
 * Visit each film needing enrichment and write TMDB's answer to every row
 * that holds it.
 *
 * Never touches `rating`, `is_watched` or `watched_at` — those are the
 * owner's, not TMDB's.
 */
export async function backfillEnrichment(options: BackfillOptions = {}): Promise<BackfillResult> {
  const { limit = 400, spacingMs = 300, clerkUserId, logger = rootLogger } = options;

  const tmdbIds = await filmsNeedingVisit(limit, clerkUserId);
  if (tmdbIds.length === 0) return { films: 0, enriched: 0, failed: 0, rows: 0, more: false };

  logger.info({ films: tmdbIds.length, clerkUserId: clerkUserId ?? null }, "enrich backfill: starting");

  let enriched = 0;
  let failed = 0;
  let rows = 0;

  for (const tmdbId of tmdbIds) {
    try {
      const details = await fetchMovieDetails(tmdbId);
      if (!details) {
        // A null here is the details request itself failing, which is as
        // likely to be a blip as a deleted film — and blips are not cached.
        // Leaving enriched_at null means the next run tries again.
        failed++;
        continue;
      }

      const written = await db
        .update(moviesTable)
        .set({
          director: details.director,
          cast: details.cast,
          genres: details.genres,
          language: details.language,
          watchProviders: details.watchProviders,
          runtime: details.runtime,
          tmdbRating: details.tmdbRating,
          enrichedAt: new Date(),
        })
        .where(
          clerkUserId
            ? and(eq(moviesTable.tmdbId, tmdbId), eq(moviesTable.clerkUserId, clerkUserId))
            : eq(moviesTable.tmdbId, tmdbId),
        )
        .returning({ id: moviesTable.id });

      enriched++;
      rows += written.length;
    } catch (err) {
      logger.warn({ err, tmdbId }, "enrich backfill: film failed");
      failed++;
    }

    await new Promise((r) => setTimeout(r, spacingMs));
  }

  const result: BackfillResult = { films: tmdbIds.length, enriched, failed, rows, more: tmdbIds.length === limit };
  logger.info(result, "enrich backfill: finished");
  return result;
}

/**
 * How many films are still waiting, without fetching any of them. For the
 * boot log, so a deploy says up front whether there is anything to do.
 */
export async function countFilmsNeedingVisit(clerkUserId?: string): Promise<number> {
  const missing = sql`(
    array_length(${moviesTable.genres}, 1) IS NULL
    OR ${moviesTable.runtime} IS NULL
    OR ${moviesTable.tmdbRating} IS NULL
  )`;
  const result = await db
    .select({ films: sql<string>`count(distinct ${moviesTable.tmdbId})` })
    .from(moviesTable)
    .where(
      clerkUserId
        ? and(isNull(moviesTable.enrichedAt), missing, eq(moviesTable.clerkUserId, clerkUserId))
        : and(isNull(moviesTable.enrichedAt), missing),
    );
  return Number(result[0]?.films ?? 0);
}

/**
 * The boot-time run: keep going until the queue is empty rather than stopping
 * at one batch, because a batch left over would otherwise wait for the next
 * deploy. Paced at a film every 300ms, so even a few thousand is a background
 * trickle that finishes inside the hour and then never runs again.
 *
 * The ceiling is a runaway guard, not a quota.
 */
export async function backfillUntilDone(ceiling = 20_000): Promise<BackfillResult> {
  const total: BackfillResult = { films: 0, enriched: 0, failed: 0, rows: 0, more: false };

  while (total.films < ceiling) {
    const pass = await backfillEnrichment({ limit: 400 });
    total.films += pass.films;
    total.enriched += pass.enriched;
    total.failed += pass.failed;
    total.rows += pass.rows;
    // A pass that did not fill its batch has emptied the queue — barring the
    // films that failed, which the next boot retries.
    if (!pass.more) break;
    // A full batch where nothing succeeded is TMDB being unreachable, not
    // progress. The failed films keep their null enriched_at, so the next
    // pass would hand back the same four hundred and loop until the ceiling.
    if (pass.enriched === 0) break;
  }

  total.more = total.films >= ceiling;
  return total;
}

/** Suppress the boot-time run, if it ever needs suppressing. */
export function backfillOnBootEnabled(): boolean {
  return process.env["ENRICH_ON_BOOT"] !== "0";
}
