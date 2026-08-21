/**
 * geminiUrlAnalyzer.ts
 *
 * Uses Gemini 2.5 Flash with Google Search grounding to describe the content
 * of any public social media URL — YouTube, TikTok, Instagram, Facebook, or
 * anything else Google has indexed.
 *
 * This replaces platform-specific scrapers (RapidAPI, HTML og:description
 * scraping) with a single general-purpose step. The returned text is then
 * passed into extractMoviesWithGemini() for structured film extraction.
 *
 * Why this works:
 *   Google indexes the vast majority of public social content. When Gemini is
 *   given a TikTok/YouTube/Instagram URL it can search Google to find the
 *   video title, creator, caption, and any film references discussed — without
 *   us maintaining any platform-specific scraping code.
 *
 * Limitation:
 *   Private posts and very new content (<24–48 h old) may not be indexed yet.
 *   In those cases this returns null and the caller falls back to yt-dlp audio.
 *
 * The prompt requires Gemini to explicitly say whether it verified the exact
 * URL's content (FOUND) or couldn't (NOT_FOUND) rather than letting it quietly
 * substitute similar/typical content for the account — grounding via a bare
 * URL search can otherwise return confident, wrong results for content that
 * isn't well indexed (e.g. many Instagram posts).
 */

import { GoogleGenAI } from "@google/genai";
import type { GeminiExtractionResult } from "./geminiParser";
import { GEMINI_MODEL } from "./geminiModel";
import { extractMoviesWithGemini } from "./geminiParser";

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  if (!_client) _client = new GoogleGenAI({ apiKey });
  return _client;
}

/**
 * Step 1 — ask Gemini (with Google Search grounding) to describe the content
 * at `url`, focusing on any film references.
 *
 * Returns plain text that can be passed to extractMoviesWithGemini(), or null
 * when Gemini could not find useful information (private content, not indexed).
 */
async function fetchUrlDescription(url: string): Promise<string | null> {
  const ai = getClient();

  const prompt =
    `Search for information about this exact URL and summarise what it contains, ` +
    `paying close attention to any films, movies, or cinema being discussed, ` +
    `reviewed, recommended, or referenced.\n\n` +
    `URL: ${url}\n\n` +
    `Critical rule: only report content you can verify is genuinely from THIS ` +
    `SPECIFIC URL — a matching post ID/shortcode, an exact caption quote, or a ` +
    `direct search result for this precise link. Do NOT substitute or infer from ` +
    `the creator's other posts, the account's general theme, similar-sounding ` +
    `content, or your general knowledge of what this type of account usually ` +
    `posts. Guessing here is worse than saying nothing — a user's watchlist gets ` +
    `corrupted with wrong films if you report unverified content as if it were ` +
    `this post.\n\n` +
    `Respond in exactly this format:\n` +
    `First line: either "FOUND" (you verified specific content for this exact URL) ` +
    `or "NOT_FOUND" (you could not verify the specific content of this exact URL).\n` +
    `If FOUND, follow with: the platform, creator/channel name, and — most ` +
    `importantly — any specific film titles, directors, or movie references ` +
    `mentioned. If the page is a film listing, ranked countdown (e.g. "Top 10 ` +
    `Horror Films of All Time"), or watchlist, enumerate every single title shown, ` +
    `in order — do not stop after the first few if more are listed. Also state ` +
    `plainly whether this is a curated/ranked list of multiple films (and if so, ` +
    `what it's called) versus a single film being discussed.\n` +
    `If NOT_FOUND, write nothing else.`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      // Google Search grounding lets Gemini look up what this URL is about
      // without us needing to scrape it ourselves.
      tools: [{ googleSearch: {} }],
      temperature: 0,
    },
  });

  const text = (response.text ?? "").trim();

  if (/^NOT_FOUND\b/i.test(text)) return null;

  const body = text.replace(/^FOUND\s*/i, "").trim();
  // Treat very short or boilerplate-only responses as "not found" even if
  // Gemini didn't follow the FOUND/NOT_FOUND format exactly.
  if (body.length < 30) return null;
  return body;
}

/**
 * Analyse a social media URL with Gemini + Google Search grounding and return
 * extracted movie matches (plus a suggested playlist name when the content is
 * a curated/ranked list).
 *
 * Returns an empty result (not an error) when Gemini could not find useful info.
 */
export async function analyzeUrlForFilms(
  url: string
): Promise<GeminiExtractionResult> {
  const description = await fetchUrlDescription(url);
  if (!description) return { movies: [], list_title: null };
  return extractMoviesWithGemini(description);
}
