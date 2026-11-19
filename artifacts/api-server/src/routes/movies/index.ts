import { Router, type IRouter } from "express";
import { and, eq, desc, isNull } from "drizzle-orm";
import { db, moviesTable } from "@workspace/db";
import { backfillEnrichment, countFilmsNeedingVisit } from "../../lib/enrichBackfill";
import {
  ListMoviesResponse,
  AddMovieBody,
  AddMovieResponse,
  DeleteMovieParams,
  AiExtractBody,
  AiExtractResponse,
  ProcessSocialLinkBody,
  ProcessSocialLinkResponse,
  ExtractFromImageBody,
  RecommendMoviesBody,
  RecommendMoviesResponse,
  GetMovieDetailsParams,
  GetMovieDetailsResponse,
  PatchWatchedParams,
  PatchWatchedBody,
  PatchRatingBody,
  PatchRatingParams,
  GetTrendingResponse,
  GetNewReleasesResponse,
  SearchMoviesResponse,
  GetRecommendationsResponse,
} from "@workspace/api-zod";
import {
  searchTmdb,
  searchMoviesUI,
  fetchMovieDetails,
  fetchTrending,
  fetchNowPlaying,
  fetchTmdbRecommendations,
  enrichCandidates,
  normalizeRegion,
  DEFAULT_REGION,
  normalizeMediaType,
  fetchSimilarMovies,
  fetchPersonDetails,
  type TmdbCandidate,
} from "../../lib/tmdb";
import { cached } from "../../lib/cache";

// Trending/new-releases are identical for every user, and each load fans out
// to ~40 extra TMDB requests via enrichCandidates (credits + watch-providers
// per movie) — cache the enriched result so concurrent/repeat page loads
// don't re-fetch. Recommendations is per-user and lower-volume, so it's left
// uncached for now.
const DISCOVERY_CACHE_TTL_MS = 20 * 60 * 1000;
import { runMoviePipeline, enrichAndSaveMatches } from "../../lib/moviePipeline";
import { processSocialLink } from "../../lib/processSocialLink";
import { extractMoviesFromImage } from "../../lib/imageExtractor";
import { getRecommendations } from "../../lib/geminiRecommender";
import { pickSeeds, RECENCY_HALF_LIFE_DAYS } from "../../lib/recommendationSeeds";
import { requireAuth, type AuthedRequest } from "../../middlewares/requireAuth";
import { clientSupportsTv } from "../../lib/clientCapabilities";

/**
 * Drop series for a build that cannot handle them.
 *
 * See lib/clientCapabilities.ts: an old build does not ignore a series, it
 * saves it as a film with a TMDB id belonging to something else entirely.
 */
const forClient = (
  movies: TmdbCandidate[],
  supportsTv: boolean,
): TmdbCandidate[] => (supportsTv ? movies : movies.filter((m) => m.mediaType !== "tv"));

const router: IRouter = Router();

// ── Discovery — public endpoints ─────────────────────────────────────────────

// GET /movies/trending
router.get("/movies/trending", async (req, res): Promise<void> => {
  try {
    const region = normalizeRegion(req.query.region);
    const movies = await cached(`trending:${region}`, DISCOVERY_CACHE_TTL_MS, async () =>
      enrichCandidates(await fetchTrending(), region)
    );
    // Filtered on the way out rather than cached twice: the full list is
    // the expensive thing to build, and it is the same list either way.
    res.json(GetTrendingResponse.parse({ movies: forClient(movies, clientSupportsTv(req)) }));
  } catch (err) {
    req.log.error({ err }, "trending: TMDB fetch failed");
    res.status(502).json({ error: "Could not fetch trending movies from TMDB" });
  }
});

// GET /movies/new-releases
router.get("/movies/new-releases", async (req, res): Promise<void> => {
  try {
    const region = normalizeRegion(req.query.region);
    const movies = await cached(`new-releases:${region}`, DISCOVERY_CACHE_TTL_MS, async () =>
      enrichCandidates(await fetchNowPlaying(region), region)
    );
    res.json(
      GetNewReleasesResponse.parse({ movies: forClient(movies, clientSupportsTv(req)) }),
    );
  } catch (err) {
    req.log.error({ err }, "new-releases: TMDB fetch failed");
    res.status(502).json({ error: "Could not fetch new releases from TMDB" });
  }
});

// GET /movies/search?q=
router.get("/movies/search", async (req, res): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.status(400).json({ error: "q is required" });
    return;
  }
  try {
    const movies = await searchMoviesUI(q);
    res.json(
      SearchMoviesResponse.parse({ movies: forClient(movies, clientSupportsTv(req)) }),
    );
  } catch (err) {
    req.log.error({ err }, "search: TMDB fetch failed");
    res.status(502).json({ error: "Could not search TMDB" });
  }
});

// GET /movies/tmdb/:tmdbId — fetch full TMDB details without saving
router.get("/movies/tmdb/:tmdbId", async (req, res): Promise<void> => {
  const params = GetMovieDetailsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const region = normalizeRegion(req.query.region);
    const mediaType = normalizeMediaType(req.query.mediaType);
    const details = await fetchMovieDetails(params.data.tmdbId, region, mediaType);
    if (!details) {
      res.status(404).json({ error: "Movie not found on TMDB" });
      return;
    }
    res.json(GetMovieDetailsResponse.parse(details));
  } catch (err) {
    req.log.error({ err, tmdbId: params.data.tmdbId }, "TMDB detail fetch failed");
    res.status(502).json({ error: "Could not fetch movie details from TMDB" });
  }
});

// GET /movies/tmdb/:tmdbId/similar — films worth watching next
//
// Public, like the rest of discovery: browsing needs no account.
router.get("/movies/tmdb/:tmdbId/similar", async (req, res): Promise<void> => {
  const params = GetMovieDetailsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    // No filter here: TMDB's recommendations for a series are series and
    // for a film are films, so a build that cannot show television never
    // asks this question about one in the first place.
    const movies = await fetchSimilarMovies(
      params.data.tmdbId,
      12,
      normalizeMediaType(req.query.mediaType),
    );
    res.json({ movies });
  } catch (err) {
    req.log.error({ err, tmdbId: params.data.tmdbId }, "TMDB similar fetch failed");
    res.status(502).json({ error: "Could not fetch similar films from TMDB" });
  }
});

// GET /people/:personId — a director or actor, and everything they have made
//
// Returns both filmographies rather than picking one. Whether somebody is
// "a director" or "an actor" is not a property of the person — plenty are
// both — so the screen leads with whichever list the user came looking for.
router.get("/people/:personId", async (req, res): Promise<void> => {
  const personId = Number(req.params.personId);
  if (!Number.isInteger(personId) || personId <= 0) {
    res.status(400).json({ error: "personId must be a positive integer" });
    return;
  }
  try {
    const person = await fetchPersonDetails(personId);
    if (!person) {
      res.status(404).json({ error: "Person not found on TMDB" });
      return;
    }
    res.json(person);
  } catch (err) {
    req.log.error({ err, personId }, "TMDB person fetch failed");
    res.status(502).json({ error: "Could not fetch that person from TMDB" });
  }
});

// ── Protected locker routes (require Clerk auth) ──────────────────────────────

// GET /movies/recommendations — personalised from the user's locker
//
// Built by asking TMDB what is similar to a handful of your films. Which
// films those are is the whole of the personalisation, and lives in
// lib/recommendationSeeds.ts — it weights what you have watched above what
// you have merely saved, scales by your rating, and decays with age so the
// rail follows what you have been watching lately rather than freezing on
// whatever you rated highest when you joined.
const SEED_COUNT = 5;

router.get("/movies/recommendations", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  try {
    const watchlist = await db
      .select()
      .from(moviesTable)
      .where(eq(moviesTable.clerkUserId, clerkUserId))
      .orderBy(desc(moviesTable.addedAt));

    if (watchlist.length === 0) {
      res.json(GetRecommendationsResponse.parse({ movies: [] }));
      return;
    }

    // Keyed by kind as well as id throughout. Film 1399 and series 1399
    // are different titles, so a set of bare ids would have a film in the
    // locker suppress an unrelated series from the rail, and vice versa.
    const key = (c: { tmdbId: number; mediaType?: string | null }) =>
      `${normalizeMediaType(c.mediaType)}:${c.tmdbId}`;

    const savedTmdbIds = new Set(watchlist.map(key));
    const seeds = pickSeeds(watchlist, SEED_COUNT);

    const results = await Promise.allSettled(
      seeds.map((s) => fetchTmdbRecommendations(s.tmdbId, normalizeMediaType(s.mediaType)))
    );

    const seen = new Set<string>();
    const recommendations: TmdbCandidate[] = [];
    const failures: { tmdbId: number; err: unknown }[] = [];

    for (const [i, result] of results.entries()) {
      if (result.status === "rejected") {
        // Collected rather than skipped. A rejected seed is a fifth of the
        // rail gone, and all five rejecting is an EMPTY rail served as a
        // perfectly ordinary 200 — which is how this failing looked exactly
        // like this working, for as long as nobody was watching TMDB.
        failures.push({ tmdbId: seeds[i]!.tmdbId, err: result.reason });
        continue;
      }
      for (const movie of result.value) {
        if (savedTmdbIds.has(key(movie))) continue;
        if (seen.has(key(movie))) continue;
        seen.add(key(movie));
        recommendations.push(movie);
      }
    }

    if (failures.length > 0) {
      req.log.warn(
        {
          failed: failures.length,
          of: seeds.length,
          seeds: failures.map((f) => f.tmdbId),
          err: failures[0]!.err,
          pooled: recommendations.length,
        },
        "recommendations: some seeds failed at TMDB",
      );
    }

    // Every seed failed, so there is nothing to show and no reason to
    // pretend otherwise. An empty 200 means "your locker suggests nothing",
    // and the client hides the rail on it — which for a TMDB outage is the
    // wrong answer given silently. A 502 lets it offer Retry instead.
    if (failures.length === seeds.length) {
      res.status(502).json({ error: "Could not fetch recommendations" });
      return;
    }

    const region = normalizeRegion(req.query.region);
    const enriched = await enrichCandidates(
      forClient(recommendations, clientSupportsTv(req)).slice(0, 20),
      region,
    );

    req.log.info(
      {
        seeds: seeds.map((s) => s.tmdbId),
        halfLifeDays: RECENCY_HALF_LIFE_DAYS,
        pooled: recommendations.length,
        returned: enriched.length,
      },
      "recommendations: served",
    );

    res.json(GetRecommendationsResponse.parse({ movies: enriched }));
  } catch (err) {
    req.log.error({ err }, "recommendations: failed");
    res.status(502).json({ error: "Could not fetch recommendations" });
  }
});

// GET /movies — list authenticated user's watchlist
router.get("/movies", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const movies = await db
    .select()
    .from(moviesTable)
    .where(eq(moviesTable.clerkUserId, clerkUserId))
    .orderBy(desc(moviesTable.addedAt));
  res.json(ListMoviesResponse.parse({ movies }));
});

// POST /movies/enrich-all — backfill TMDB metadata for this user's films
//
// The same work the server does for everybody in the background after boot,
// scoped to one locker and triggerable on demand. Kept for the case where a
// locker needs filling in without waiting for a deploy.
router.post("/movies/enrich-all", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const waiting = await countFilmsNeedingVisit(clerkUserId);

  // Answered before the work starts: enrichment is a few hundred milliseconds
  // per film and the client has nothing to do with the result.
  res.json({ started: waiting, message: "Enrichment running in background" });

  backfillEnrichment({ clerkUserId, logger: req.log })
    .then((result) => req.log.info(result, "enrich-all: complete"))
    .catch((err) => req.log.warn({ err }, "enrich-all: failed"));
});

// POST /movies — add a movie to the authenticated user's locker
router.post("/movies", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const parsed = AddMovieBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // isWatched is optional and separate from the columns that describe the
  // film, so it is pulled out rather than spread blindly into the insert.
  // It exists so "I've seen this" is one action: adding and then patching
  // meant two round trips and a film that was briefly on the wrong list.
  const { isWatched, ...film } = parsed.data;

  // Every lookup below has to carry the kind, not just the id. The unique
  // index on movies is (tmdb_id, clerk_user_id, media_type), so without it
  // an "already in your locker" check for series 1399 matches the FILM
  // 1399 row — and the response says the series was added while handing
  // back a different title entirely.
  const mediaType = normalizeMediaType(film.mediaType);
  const sameTitle = and(
    eq(moviesTable.tmdbId, parsed.data.tmdbId),
    eq(moviesTable.clerkUserId, clerkUserId),
    eq(moviesTable.mediaType, mediaType),
  );

  const [movie] = await db
    .insert(moviesTable)
    .values({
      ...film,
      mediaType,
      clerkUserId,
      isWatched: isWatched ?? false,
      watchedAt: isWatched ? new Date() : null,
    })
    .onConflictDoNothing()
    .returning();

  if (!movie) {
    // Already in the locker, so the insert above wrote nothing — including
    // the source. Fill it in only where there is not one already: the same
    // "first post wins" rule the extraction pipeline uses, since the
    // original post is the one that made you save the film, and running
    // into it again later does not rewrite that. A film first added by
    // search does pick one up here, because that is a null being filled.
    if (film.sourceUrl) {
      await db
        .update(moviesTable)
        .set({ sourceUrl: film.sourceUrl })
        .where(and(sameTitle, isNull(moviesTable.sourceUrl)));
    }

    // Adding it as watched should still mark it so,
    // otherwise the button does nothing for a film already on the watchlist
    // — which is the common case for "I've finally seen this".
    if (isWatched) {
      const [promoted] = await db
        .update(moviesTable)
        .set({ isWatched: true, watchedAt: new Date() })
        .where(and(sameTitle, eq(moviesTable.isWatched, false)))
        .returning();
      if (promoted) {
        res.status(200).json(AddMovieResponse.parse(promoted));
        return;
      }
    }

    const [existing] = await db.select().from(moviesTable).where(sameTitle);
    res.status(200).json(AddMovieResponse.parse(existing));
    return;
  }

  res.status(201).json(AddMovieResponse.parse(movie));

  fetchMovieDetails(movie.tmdbId, DEFAULT_REGION, mediaType)
    .then(async (details) => {
      if (!details) return;
      await db
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
        .where(and(eq(moviesTable.id, movie.id), eq(moviesTable.clerkUserId, clerkUserId)));
    })
    .catch((err) => {
      req.log.warn({ err, tmdbId: movie.tmdbId }, "Background enrichment failed");
    });
});

// POST /movies/ai-extract — extract & save films from text
router.post("/movies/ai-extract", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const parsed = AiExtractBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  req.log.info("ai-extract: running Gemini pipeline");
  const { matches, saved } = await runMoviePipeline(
    parsed.data.text,
    (data, msg) => req.log.warn(data, msg),
    false,
    clerkUserId,
    false,
    { supportsTv: clientSupportsTv(req) },
  );

  req.log.info({ matchCount: matches.length, saved: saved.length }, "ai-extract: complete");
  res.json(AiExtractResponse.parse({ matches, saved }));
});

// POST /movies/process-social-link — process social URL (dry-run or save)
router.post("/movies/process-social-link", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const parsed = ProcessSocialLinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const dryRun = Boolean(parsed.data.dryRun);
  req.log.info({ url: parsed.data.url, dryRun }, "process-social-link: start");

  const result = await processSocialLink(
    parsed.data.url,
    (data, msg) => req.log.warn(data, msg),
    dryRun,
    clerkUserId,
    clientSupportsTv(req),
  );

  req.log.info(
    { source: result.source, matches: result.matches.length, saved: result.saved.length },
    "process-social-link: complete"
  );

  res.json(ProcessSocialLinkResponse.parse(result));
});

// POST /movies/extract-from-image — read films out of a supplied photo/screenshot
router.post("/movies/extract-from-image", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const parsed = ExtractFromImageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const dryRun = Boolean(parsed.data.dryRun);
  const { imageBase64, mimeType } = parsed.data;
  req.log.info({ mimeType, bytes: imageBase64.length, dryRun }, "extract-from-image: start");

  let extraction;
  try {
    extraction = await extractMoviesFromImage(imageBase64, mimeType);
  } catch (err) {
    req.log.warn({ err }, "extract-from-image: Gemini image extraction failed");
    // A bad or oversized image is the caller's problem to fix; anything else
    // (Gemini being down or out of quota) is not, but from here both look the
    // same to the user, so return the empty-result shape the client already
    // handles rather than an error it would have to special-case.
    res.json(
      ProcessSocialLinkResponse.parse({
        source: "none",
        text: null,
        matches: [],
        saved: [],
        listTitle: null,
      })
    );
    return;
  }

  const { matches, saved, listTitle } = await enrichAndSaveMatches(
    extraction.movies,
    (data, msg) => req.log.warn(data, msg),
    dryRun,
    clerkUserId,
    extraction.list_title,
    { supportsTv: clientSupportsTv(req) },
  );

  req.log.info(
    { matches: matches.length, saved: saved.length, listTitle },
    "extract-from-image: complete"
  );

  res.json(
    ProcessSocialLinkResponse.parse({
      source: matches.length > 0 ? "image" : "none",
      text: null,
      matches,
      saved,
      listTitle,
    })
  );
});

// POST /movies/recommend — natural-language film/TV recommendation (dry-run or save)
router.post("/movies/recommend", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const parsed = RecommendMoviesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const dryRun = Boolean(parsed.data.dryRun);
  req.log.info({ query: parsed.data.query, dryRun }, "recommend: start");

  const { offTopic, movies, list_title } = await getRecommendations(parsed.data.query);

  if (offTopic) {
    req.log.info({ query: parsed.data.query }, "recommend: off-topic query refused");
    res.json(RecommendMoviesResponse.parse({ offTopic: true, matches: [], saved: [], listTitle: null }));
    return;
  }

  const { matches, saved, listTitle } = await enrichAndSaveMatches(
    movies,
    (data, msg) => req.log.warn(data, msg),
    dryRun,
    clerkUserId,
    list_title,
    { supportsTv: clientSupportsTv(req) },
  );

  req.log.info({ matchCount: matches.length, saved: saved.length }, "recommend: complete");
  res.json(RecommendMoviesResponse.parse({ offTopic: false, matches, saved, listTitle }));
});

// PATCH /movies/:id/watched — toggle watched status (ownership verified)
router.patch("/movies/:id/watched", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const params = PatchWatchedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = PatchWatchedBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [updated] = await db
    .update(moviesTable)
    .set({
      isWatched: body.data.isWatched,
      watchedAt: body.data.isWatched ? new Date() : null,
    })
    .where(and(eq(moviesTable.id, params.data.id), eq(moviesTable.clerkUserId, clerkUserId)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Movie not found" });
    return;
  }

  res.json(AddMovieResponse.parse(updated));
});

// PATCH /movies/:id/rating — set star rating (ownership verified)
router.patch("/movies/:id/rating", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const params = PatchRatingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = PatchRatingBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [updated] = await db
    .update(moviesTable)
    .set({ rating: body.data.rating })
    .where(and(eq(moviesTable.id, params.data.id), eq(moviesTable.clerkUserId, clerkUserId)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Movie not found" });
    return;
  }

  res.json(AddMovieResponse.parse(updated));
});

// DELETE /movies/:id — remove from locker (ownership verified)
router.delete("/movies/:id", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const params = DeleteMovieParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(moviesTable)
    .where(and(eq(moviesTable.id, params.data.id), eq(moviesTable.clerkUserId, clerkUserId)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Movie not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
