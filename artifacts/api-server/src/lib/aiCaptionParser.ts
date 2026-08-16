/**
 * aiCaptionParser.ts
 *
 * AI-powered caption parser used by the /movies/parse-caption route.
 * Delegates to the shared Gemini extraction pipeline (extractMoviesWithGemini)
 * and returns just the movie title strings for TMDB lookup.
 *
 * Replaced the previous OpenAI GPT-4o-mini implementation; now uses only
 * GEMINI_API_KEY — no OPENAI_API_KEY required.
 */

import { extractMoviesWithGemini } from "./geminiParser";

/** Minimum confidence to include a Gemini match as a title candidate. */
const CONFIDENCE_THRESHOLD = 0.45;

/**
 * Extract movie title candidates from a social media caption using Gemini.
 * Returns an array of title strings for the caller to look up in TMDB.
 */
export async function extractMovieTitlesAI(caption: string): Promise<string[]> {
  const { movies } = await extractMoviesWithGemini(caption);
  return movies
    .filter((m) => m.confidence_score >= CONFIDENCE_THRESHOLD)
    .map((m) => m.movie_title);
}
