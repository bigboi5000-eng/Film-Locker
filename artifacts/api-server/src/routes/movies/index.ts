import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, moviesTable } from "@workspace/db";
import {
  ListMoviesResponse,
  AddMovieBody,
  AddMovieResponse,
  ParseCaptionBody,
  ParseCaptionResponse,
  DeleteMovieParams,
  AiExtractBody,
  AiExtractResponse,
  ProcessSocialLinkBody,
  ProcessSocialLinkResponse,
  GetMovieDetailsParams,
  GetMovieDetailsResponse,
  PatchWatchedParams,
  PatchWatchedBody,
  PatchRatingBody,
  PatchRatingParams,
  GetTrendingResponse,
  GetNewReleasesResponse,
  SearchMoviesResponse,
} from "@workspace/api-zod";
import { searchTmdb, searchMoviesUI, fetchMovieDetails, fetchTrending, fetchNowPlaying } from "../../lib/tmdb";
import { extractMovieTitlesAI } from "../../lib/aiCaptionParser";
import { runMoviePipeline } from "../../lib/moviePipeline";
import { processSocialLink } from "../../lib/processSocialLink";

const router: IRouter = Router();

// ── Discovery (Home screen) ───────────────────────────────────────────────────

// GET /movies/trending
router.get("/movies/trending", async (req, res): Promise<void> => {
  try {
    const movies = await fetchTrending();
    res.json(GetTrendingResponse.parse({ movies }));
  } catch (err) {
    req.log.error({ err }, "trending: TMDB fetch failed");
    res.status(502).json({ error: "Could not fetch trending movies from TMDB" });
  }
});

// GET /movies/new-releases
router.get("/movies/new-releases", async (req, res): Promise<void> => {
  try {
    const movies = await fetchNowPlaying();
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

// ── Caption parsing ───────────────────────────────────────────────────────────

// POST /movies/parse-caption
router.post("/movies/parse-caption", async (req, res): Promise<void> => {
  const parsed = ParseCaptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const titleCandidates = await extractMovieTitlesAI(parsed.data.caption);
  req.log.info(
    { count: titleCandidates.length, candidates: titleCandidates },
    "Extracted caption candidates (AI)"
  );

  const seen = new Set<number>();
  const results: Array<{
    tmdbId: number;
    title: string;
    releaseYear: string;
    posterUrl: string;
    overview: string;
  }> = [];

  for (const candidate of titleCandidates) {
    try {
      const hits = await searchTmdb(candidate);
      for (const hit of hits) {
        if (!seen.has(hit.tmdbId)) {
          seen.add(hit.tmdbId);
          results.push(hit);
        }
      }
    } catch (err) {
      req.log.warn({ candidate, err }, "TMDB search failed for candidate");
    }
  }

  res.json(ParseCaptionResponse.parse({ candidates: results.slice(0, 24) }));
});

// ── AI extraction ─────────────────────────────────────────────────────────────

// POST /movies/ai-extract
router.post("/movies/ai-extract", async (req, res): Promise<void> => {
  const parsed = AiExtractBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  req.log.info("ai-extract: running Gemini pipeline");
  const { matches, saved } = await runMoviePipeline(
    parsed.data.text,
    (data, msg) => req.log.warn(data, msg)
  );

  req.log.info({ matchCount: matches.length, saved: saved.length }, "ai-extract: complete");
  res.json(AiExtractResponse.parse({ matches, saved }));
});

// ── Social link processing ────────────────────────────────────────────────────

// POST /movies/process-social-link
router.post("/movies/process-social-link", async (req, res): Promise<void> => {
  const parsed = ProcessSocialLinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  req.log.info({ url: parsed.data.url }, "process-social-link: start");

  const result = await processSocialLink(
    parsed.data.url,
    (data, msg) => req.log.warn(data, msg)
  );

  req.log.info(
    { source: result.source, matches: result.matches.length, saved: result.saved.length },
    "process-social-link: complete"
  );

  res.json(ProcessSocialLinkResponse.parse(result));
});

// ── TMDB detail fetch (for home screen / unsaved movies) ──────────────────────

// GET /movies/tmdb/:tmdbId — fetch full TMDB details without saving
router.get("/movies/tmdb/:tmdbId", async (req, res): Promise<void> => {
  const params = GetMovieDetailsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const details = await fetchMovieDetails(params.data.tmdbId);
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

// ── Locker CRUD ───────────────────────────────────────────────────────────────

// GET /movies — list all saved movies
router.get("/movies", async (_req, res): Promise<void> => {
  const movies = await db
    .select()
    .from(moviesTable)
    .orderBy(moviesTable.addedAt);
  res.json(ListMoviesResponse.parse({ movies }));
});

// POST /movies — add a movie to the locker (idempotent by tmdbId)
router.post("/movies", async (req, res): Promise<void> => {
  const parsed = AddMovieBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [movie] = await db
    .insert(moviesTable)
    .values(parsed.data)
    .onConflictDoNothing()
    .returning();

  if (!movie) {
    const [existing] = await db
      .select()
      .from(moviesTable)
      .where(eq(moviesTable.tmdbId, parsed.data.tmdbId));
    res.status(200).json(AddMovieResponse.parse(existing));
    return;
  }

  res.status(201).json(AddMovieResponse.parse(movie));
});

// PATCH /movies/:id/watched — toggle watched status
router.patch("/movies/:id/watched", async (req, res): Promise<void> => {
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
    .where(eq(moviesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Movie not found" });
    return;
  }

  res.json(AddMovieResponse.parse(updated));
});

// PATCH /movies/:id/rating — set star rating (1–5, or null to clear)
router.patch("/movies/:id/rating", async (req, res): Promise<void> => {
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
    .where(eq(moviesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Movie not found" });
    return;
  }

  res.json(AddMovieResponse.parse(updated));
});

// DELETE /movies/:id — remove a movie from the locker
router.delete("/movies/:id", async (req, res): Promise<void> => {
  const params = DeleteMovieParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(moviesTable)
    .where(eq(moviesTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Movie not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
