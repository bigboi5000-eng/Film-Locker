import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import { db, moviesTable } from "@workspace/db";
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
import { searchTmdb, searchMoviesUI, fetchMovieDetails, fetchTrending, fetchNowPlaying, fetchTmdbRecommendations, enrichCandidates, normalizeRegion, type TmdbCandidate } from "../../lib/tmdb";
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
import { requireAuth, type AuthedRequest } from "../../middlewares/requireAuth";

const router: IRouter = Router();

// ── Discovery — public endpoints ─────────────────────────────────────────────

// GET /movies/trending
router.get("/movies/trending", async (req, res): Promise<void> => {
  try {
    const region = normalizeRegion(req.query.region);
    const movies = await cached(`trending:${region}`, DISCOVERY_CACHE_TTL_MS, async () =>
      enrichCandidates(await fetchTrending(), region)
    );
    res.json(GetTrendingResponse.parse({ movies }));
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
    res.json(GetNewReleasesResponse.parse({ movies }));
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
    res.json(SearchMoviesResponse.parse({ movies }));
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
    const details = await fetchMovieDetails(params.data.tmdbId, region);
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

// ── Protected locker routes (require Clerk auth) ──────────────────────────────

// GET /movies/recommendations — personalised from user's watchlist
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

    const savedTmdbIds = new Set(watchlist.map((m) => m.tmdbId));

    const scored = watchlist
      .map((m) => ({
        tmdbId: m.tmdbId,
        score: 1 + (m.rating ?? 0) + (m.isWatched ? 2 : 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const results = await Promise.allSettled(
      scored.map((s) => fetchTmdbRecommendations(s.tmdbId))
    );

    const seen = new Set<number>();
    const recommendations: TmdbCandidate[] = [];

    for (const result of results) {
      if (result.status === "rejected") continue;
      for (const movie of result.value) {
        if (savedTmdbIds.has(movie.tmdbId)) continue;
        if (seen.has(movie.tmdbId)) continue;
        seen.add(movie.tmdbId);
        recommendations.push(movie);
      }
    }

    const region = normalizeRegion(req.query.region);
    const enriched = await enrichCandidates(recommendations.slice(0, 20), region);
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

// POST /movies/enrich-all — backfill enrichment for user's movies missing metadata
router.post("/movies/enrich-all", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const { sql: drizzleSql } = await import("drizzle-orm");
  const unenriched = await db
    .select()
    .from(moviesTable)
    .where(
      and(
        eq(moviesTable.clerkUserId, clerkUserId),
        drizzleSql`array_length(${moviesTable.genres}, 1) IS NULL`
      )
    );

  req.log.info({ count: unenriched.length }, "enrich-all: starting");
  res.json({ started: unenriched.length, message: "Enrichment running in background" });

  for (const movie of unenriched) {
    try {
      const details = await fetchMovieDetails(movie.tmdbId);
      if (!details) continue;
      await db
        .update(moviesTable)
        .set({
          director: details.director,
          cast: details.cast,
          genres: details.genres,
          language: details.language,
          watchProviders: details.watchProviders,
        })
        .where(and(eq(moviesTable.id, movie.id), eq(moviesTable.clerkUserId, clerkUserId)));
      req.log.info({ tmdbId: movie.tmdbId, title: movie.title }, "enrich-all: enriched");
    } catch (err) {
      req.log.warn({ err, tmdbId: movie.tmdbId }, "enrich-all: failed");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  req.log.info("enrich-all: complete");
});

// POST /movies — add a movie to the authenticated user's locker
router.post("/movies", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const parsed = AddMovieBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [movie] = await db
    .insert(moviesTable)
    .values({ ...parsed.data, clerkUserId })
    .onConflictDoNothing()
    .returning();

  if (!movie) {
    const [existing] = await db
      .select()
      .from(moviesTable)
      .where(
        and(
          eq(moviesTable.tmdbId, parsed.data.tmdbId),
          eq(moviesTable.clerkUserId, clerkUserId)
        )
      );
    res.status(200).json(AddMovieResponse.parse(existing));
    return;
  }

  res.status(201).json(AddMovieResponse.parse(movie));

  fetchMovieDetails(movie.tmdbId)
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
    clerkUserId
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
    clerkUserId
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
    extraction.list_title
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
    list_title
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
