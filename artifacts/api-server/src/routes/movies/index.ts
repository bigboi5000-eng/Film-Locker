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
} from "@workspace/api-zod";
import { searchTmdb } from "../../lib/tmdb";
import { extractMovieTitlesAI } from "../../lib/aiCaptionParser";
import { runMoviePipeline } from "../../lib/moviePipeline";
import { processSocialLink } from "../../lib/processSocialLink";

const router: IRouter = Router();

// GET /movies — list all saved movies
router.get("/movies", async (_req, res): Promise<void> => {
  const movies = await db
    .select()
    .from(moviesTable)
    .orderBy(moviesTable.addedAt);
  res.json(ListMoviesResponse.parse({ movies }));
});

// POST /movies/parse-caption — extract movie candidates from a social caption
// IMPORTANT: must be declared before /movies/:id to avoid param collision
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

// POST /movies/ai-extract — Gemini structured extraction → TMDB enrichment → auto-save
// IMPORTANT: must be declared before /movies/:id to avoid param collision
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

// POST /movies/process-social-link — fetch caption or transcribe audio → Gemini → save
// IMPORTANT: must be declared before /movies/:id to avoid param collision
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
