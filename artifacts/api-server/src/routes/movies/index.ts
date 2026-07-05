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
} from "@workspace/api-zod";
import { searchTmdb } from "../../lib/tmdb";
import { extractMovieTitlesAI } from "../../lib/aiCaptionParser";
import { extractMoviesWithGemini } from "../../lib/geminiParser";

type SavedMovie = typeof moviesTable.$inferSelect;

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

  // 1. Gemini structured extraction
  let rawMatches = await extractMoviesWithGemini(parsed.data.text);
  req.log.info({ count: rawMatches.length }, "Gemini extracted movie matches");

  // Sanitize confidence scores (guard against NaN / non-finite values from model)
  rawMatches = rawMatches.map((m) => ({
    ...m,
    confidence_score: Number.isFinite(m.confidence_score)
      ? Math.min(1, Math.max(0, m.confidence_score))
      : 0,
  }));

  // Sort by confidence descending
  rawMatches.sort((a, b) => b.confidence_score - a.confidence_score);

  // 2. For each match: TMDB lookup → DB upsert
  const seenTmdb = new Set<number>();
  const saved: SavedMovie[] = [];

  // Enrich matches with resolved TMDB id so frontend can correlate accurately
  const enrichedMatches: Array<{
    movie_title: string;
    release_year: string;
    confidence_score: number;
    tmdb_id: number | null;
  }> = [];

  for (const match of rawMatches) {
    // Skip low-confidence or non-finite score matches
    if (!(match.confidence_score >= 0.45)) {
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
        // Already in locker — return the existing record so the UI can show it
        const [existing] = await db
          .select()
          .from(moviesTable)
          .where(eq(moviesTable.tmdbId, hit.tmdbId));
        if (existing) saved.push(existing);
      }
    } catch (err) {
      req.log.warn({ match, err }, "ai-extract: TMDB/DB step failed for match");
      enrichedMatches.push({ ...match, tmdb_id: null });
    }
  }

  req.log.info({ saved: saved.length }, "ai-extract: movies saved/found");
  res.json(AiExtractResponse.parse({ matches: enrichedMatches, saved }));
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
