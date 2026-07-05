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
} from "@workspace/api-zod";
import { searchTmdb } from "../../lib/tmdb";
import { extractTitleCandidates } from "../../lib/captionParser";

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

  const titleCandidates = extractTitleCandidates(parsed.data.caption);
  req.log.info({ count: titleCandidates.length, candidates: titleCandidates }, "Extracted caption candidates");

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
    // Already in locker — return existing record
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
