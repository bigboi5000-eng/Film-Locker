import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
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
import { debugInstagramScrape } from "../../lib/socialScraper";
import { extractMoviesWithGemini } from "../../lib/geminiParser";

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

// ── Social link debug ─────────────────────────────────────────────────────────

// POST /movies/debug-social-link
// Returns every intermediate value: raw scraper JSON, extracted caption,
// Gemini input/output. Never saves anything to the DB.
router.post("/movies/debug-social-link", async (req, res): Promise<void> => {
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  req.log.info({ url }, "debug-social-link: start");

  // Step 1 — Instagram scraper (raw + extracted caption)
  let scraperResult: Awaited<ReturnType<typeof debugInstagramScrape>> | null = null;
  let scraperError: string | null = null;
  try {
    scraperResult = await debugInstagramScrape(url);
  } catch (err) {
    scraperError = err instanceof Error ? err.message : String(err);
  }

  const caption = scraperResult?.extractedCaption ?? null;

  // Step 2 — Gemini (only if caption was found)
  let geminiInput: string | null = null;
  let geminiRaw: unknown = null;
  let geminiError: string | null = null;
  if (caption) {
    geminiInput = caption;
    try {
      geminiRaw = await extractMoviesWithGemini(caption);
    } catch (err) {
      geminiError = err instanceof Error ? err.message : String(err);
    }
  }

  res.json({
    url,
    scraper: scraperError ? { error: scraperError } : scraperResult,
    gemini: {
      input: geminiInput,
      output: geminiRaw,
      error: geminiError,
    },
  });
});

// ── Social link processing ────────────────────────────────────────────────────

// POST /movies/process-social-link
router.post("/movies/process-social-link", async (req, res): Promise<void> => {
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
    dryRun
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
    .orderBy(desc(moviesTable.addedAt));
  res.json(ListMoviesResponse.parse({ movies }));
});

// POST /movies/enrich-all — backfill enrichment for movies missing genres/director
router.post("/movies/enrich-all", async (req, res): Promise<void> => {
  const { sql: drizzleSql } = await import("drizzle-orm");
  const unenriched = await db
    .select()
    .from(moviesTable)
    .where(drizzleSql`array_length(${moviesTable.genres}, 1) IS NULL`);

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
        .where(eq(moviesTable.id, movie.id));
      req.log.info({ tmdbId: movie.tmdbId, title: movie.title }, "enrich-all: enriched");
    } catch (err) {
      req.log.warn({ err, tmdbId: movie.tmdbId }, "enrich-all: failed");
    }
    // Polite TMDB rate limiting
    await new Promise((r) => setTimeout(r, 250));
  }
  req.log.info("enrich-all: complete");
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

  // Respond immediately — enrich with full TMDB metadata in the background
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
        .where(eq(moviesTable.id, movie.id));
    })
    .catch((err) => {
      req.log.warn({ err, tmdbId: movie.tmdbId }, "Background enrichment failed");
    });
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
