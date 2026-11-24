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
import { fetchMovieDetails, normalizeMediaType, DEFAULT_REGION, type MediaType } from "./tmdb";
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
/**
 * Which rows are worth a TMDB visit.
 *
 * Two different questions, which is why this is not one flat condition.
 *
 * The first is the original: a row that has never been enriched and is
 * missing something. `enriched_at IS NULL` is what stops it re-running
 * for ever — one successful visit stamps it and it leaves the queue.
 *
 * The second is a release year, and it deliberately ignores that stamp.
 * A year can be MISSING FROM TMDB when the film is saved and appear
 * weeks later — which is exactly what happens to the 2026 titles this
 * app is mostly used to save — and nothing else ever repairs it. The
 * save path does not (its upsert leaves title, poster and year alone on
 * an existing row), and before this neither did the backfill, so an
 * entry that arrived without a year kept the blank for good and the only
 * way out was to delete it and add it again.
 *
 * Re-checking an already-enriched row needs a brake, or a film TMDB
 * genuinely has no date for would be re-fetched on every boot. A week is
 * that brake, and it is also about the right cadence for the thing being
 * waited on: an unscheduled film does not get a date by the hour.
 */
const WITHOUT_A_YEAR_RECHECK_DAYS = 7;

/**
 * The queue's membership test, in one place.
 *
 * Shared by the queue and by the count that reports its size. They were
 * two copies of the same condition, which is a standing invitation to
 * change one and not the other — and then the boot log confidently
 * announces a number of films that the run does not visit.
 */
function needsVisitCondition(clerkUserId?: string) {
  const missing = sql`(
    array_length(${moviesTable.genres}, 1) IS NULL
    -- Runtime is a film's question. TMDB's episode_run_time is minutes
    -- per episode and is deliberately not stored, so a series' runtime is
    -- permanently null and would keep it in this queue for good.
    OR (${moviesTable.mediaType} = 'movie' AND ${moviesTable.runtime} IS NULL)
    OR ${moviesTable.tmdbRating} IS NULL
  )`;

  const needsVisit = sql`(
    (${moviesTable.enrichedAt} IS NULL AND ${missing})
    OR (
      coalesce(${moviesTable.releaseYear}, '') = ''
      AND (
        ${moviesTable.enrichedAt} IS NULL
        OR ${moviesTable.enrichedAt} < now() - interval '${sql.raw(String(WITHOUT_A_YEAR_RECHECK_DAYS))} days'
      )
    )
  )`;

  return clerkUserId ? and(needsVisit, eq(moviesTable.clerkUserId, clerkUserId)) : needsVisit;
}

async function filmsNeedingVisit(
  limit: number,
  clerkUserId?: string,
): Promise<Array<{ tmdbId: number; mediaType: MediaType }>> {
  const rows = await db
    .select({
      tmdbId: moviesTable.tmdbId,
      // Grouped with the id, not dropped: film 1399 and series 1399 are two
      // titles needing two different TMDB requests.
      mediaType: moviesTable.mediaType,
      oldest: sql<string>`min(${moviesTable.addedAt})`,
    })
    .from(moviesTable)
    .where(needsVisitCondition(clerkUserId))
    .groupBy(moviesTable.tmdbId, moviesTable.mediaType)
    // Oldest first, so a run that hits the cap makes deterministic progress
    // instead of revisiting whichever films the planner happened to return.
    .orderBy(asc(sql`min(${moviesTable.addedAt})`))
    .limit(limit);

  return rows.map((r) => ({ tmdbId: r.tmdbId, mediaType: normalizeMediaType(r.mediaType) }));
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

  const titles = await filmsNeedingVisit(limit, clerkUserId);
  if (titles.length === 0) return { films: 0, enriched: 0, failed: 0, rows: 0, more: false };

  logger.info({ films: titles.length, clerkUserId: clerkUserId ?? null }, "enrich backfill: starting");

  let enriched = 0;
  let failed = 0;
  let rows = 0;

  for (const { tmdbId, mediaType } of titles) {
    try {
      const details = await fetchMovieDetails(tmdbId, DEFAULT_REGION, mediaType);
      if (!details) {
        // A null here is the details request itself failing, which is as
        // likely to be a blip as a deleted film — and blips are not cached.
        // Leaving enriched_at null means the next run tries again.
        failed++;
        continue;
      }

      // A throttled credits or providers call leaves a film looking cast-
      // less and unstreamable, and writing that would be worse here than
      // anywhere else: it also stamps enrichedAt, so the film counts as
      // done and is never looked at again. Same reasoning as the null
      // above — leave it for the next run.
      if (details.degraded) {
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
          // Only when TMDB actually has one. Writing it unconditionally
          // would blank a year already on the row whenever TMDB answers
          // without a date, which is the very state being repaired.
          ...(details.releaseYear ? { releaseYear: details.releaseYear } : {}),
          enrichedAt: new Date(),
        })
        .where(
          and(
            eq(moviesTable.tmdbId, tmdbId),
            eq(moviesTable.mediaType, mediaType),
            clerkUserId ? eq(moviesTable.clerkUserId, clerkUserId) : undefined,
          ),
        )
        .returning({ id: moviesTable.id });

      enriched++;
      rows += written.length;
    } catch (err) {
      logger.warn({ err, tmdbId, mediaType }, "enrich backfill: title failed");
      failed++;
    }

    await new Promise((r) => setTimeout(r, spacingMs));
  }

  const result: BackfillResult = { films: titles.length, enriched, failed, rows, more: titles.length === limit };
  logger.info(result, "enrich backfill: finished");
  return result;
}

/**
 * How many films are still waiting, without fetching any of them. For the
 * boot log, so a deploy says up front whether there is anything to do.
 */
export async function countFilmsNeedingVisit(clerkUserId?: string): Promise<number> {
  const result = await db
    .select({
      films: sql<string>`count(distinct (${moviesTable.tmdbId}, ${moviesTable.mediaType}))`,
    })
    .from(moviesTable)
    .where(needsVisitCondition(clerkUserId));
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
