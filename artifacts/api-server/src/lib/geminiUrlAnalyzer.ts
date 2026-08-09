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
 */

import { GoogleGenAI } from "@google/genai";
import type { GeminiMovieMatch } from "./geminiParser";
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
    `Search for information about this URL and summarise what it contains, ` +
    `paying close attention to any films, movies, or cinema being discussed, ` +
    `reviewed, recommended, or referenced.\n\n` +
    `URL: ${url}\n\n` +
    `Include: the platform, creator/channel name, and — most importantly — ` +
    `any specific film titles, directors, or movie references mentioned. ` +
    `If the page is a film listing or watchlist, enumerate all titles shown.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      // Google Search grounding lets Gemini look up what this URL is about
      // without us needing to scrape it ourselves.
      tools: [{ googleSearch: {} }],
      temperature: 0,
    },
  });

  const text = (response.text ?? "").trim();
  // Treat very short or boilerplate-only responses as "not found"
  if (text.length < 30) return null;
  return text;
}

/**
 * Analyse a social media URL with Gemini + Google Search grounding and return
 * extracted movie matches.
 *
 * Returns an empty array (not an error) when Gemini could not find useful info.
 */
export async function analyzeUrlForFilms(
  url: string
): Promise<GeminiMovieMatch[]> {
  const description = await fetchUrlDescription(url);
  if (!description) return [];
  return extractMoviesWithGemini(description);
}
