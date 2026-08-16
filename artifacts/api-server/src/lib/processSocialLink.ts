/**
 * processSocialLink.ts
 *
 * Main entry point fired whenever a user submits a social media URL.
 *
 * Pipeline (in order, first success wins):
 *
 *  -1. Mixed-text extraction (e.g. Google's share format):
 *        Some share intents deliver "Film Title https://share.google/abc"
 *        We extract the URL and use the title text as a fast-path search query.
 *
 *   0. Google / Bing search URL:
 *        Extract the `q=` search query → Gemini text pipeline → TMDB → DB
 *        (Fast path — no search grounding needed, we already have the text.)
 *
 *   1. Gemini + Google Search grounding:
 *        Gemini searches Google to find out what the URL is about, then
 *        identifies any films referenced. Works for YouTube, Instagram,
 *        TikTok, Facebook, and anything else Google has indexed.
 *        No platform-specific scrapers or RapidAPI keys needed.
 *
 *   2. yt-dlp audio fallback:
 *        Downloads the audio track, sends it to Gemini 2.5 Flash via the
 *        Files API for native multimodal film extraction. Catches private
 *        or very-new content that Gemini's search index hasn't indexed yet,
 *        as long as the films are narrated aloud.
 *
 *   3. yt-dlp video fallback:
 *        Downloads the full video and sends it to Gemini natively so it can
 *        read on-screen text — catches silent "Top N" countdown posts where
 *        the list is shown as on-screen graphics with no voiceover, which
 *        step 2 would miss entirely. Slower/costlier, so it only runs when
 *        steps 1 and 2 both come up empty.
 *
 *   4. Nothing worked → return an empty result (never throws).
 *
 * The `source` field tells the UI how movies were found:
 *   "caption"   — search query or Gemini URL analysis found something
 *   "audio"     — yt-dlp + Gemini native audio understanding
 *   "video"     — yt-dlp + Gemini native video understanding (on-screen text)
 *   "none"      — all steps returned empty
 */

import { analyzeUrlForFilms } from "./geminiUrlAnalyzer";
import { extractMoviesFromAudio } from "./audioExtractor";
import { extractMoviesFromVideo } from "./videoExtractor";
import {
  runMoviePipeline,
  enrichAndSaveMatches,
  type PipelineResult,
} from "./moviePipeline";

export type SocialLinkSource = "caption" | "audio" | "video" | "none";

export interface ProcessSocialLinkResult extends PipelineResult {
  source: SocialLinkSource;
  /** The text or search query used, when source is "caption"; null otherwise. */
  text: string | null;
}

type WarnFn = (data: Record<string, unknown>, msg: string) => void;

// ── Mixed-text helpers ────────────────────────────────────────────────────────

/**
 * Google's Android share feature sends text like:
 *   "The Long Goodbye https://share.google/DrzfONL1wXppCXRwT"
 *
 * This helper extracts the URL and the leading title text so we can:
 *   1. Use the title as a fast-path text pipeline search (most reliable)
 *   2. Fall back to analysing the URL directly if the title yields nothing
 *
 * Returns null if the input already starts with "http" (plain URL, no-op).
 */
function extractUrlFromMixedText(input: string): { url: string; titleHint: string | null } | null {
  const trimmed = input.trim();
  if (trimmed.startsWith("http")) return null; // already a URL
  const match = trimmed.match(/(https?:\/\/[^\s]+)/);
  if (!match) return null;
  const url = match[1].replace(/[.,!?;:]+$/, ""); // strip trailing punctuation
  const titleHint = trimmed.slice(0, match.index).trim() || null;
  return { url, titleHint };
}

// ── Search URL helpers ────────────────────────────────────────────────────────

/**
 * If the URL is a Google or Bing search results page, return the search query.
 * Otherwise return null so the caller proceeds to Gemini URL analysis.
 *
 * Examples:
 *   https://www.google.com/search?q=inception+2010   → "inception 2010"
 *   https://www.bing.com/search?q=parasite+film      → "parasite film"
 */
function extractSearchQuery(url: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    const isSearch =
      (h.includes("google.") && u.pathname.startsWith("/search")) ||
      (h.includes("bing.com") && u.pathname.startsWith("/search"));
    if (!isSearch) return null;
    return u.searchParams.get("q") ?? u.searchParams.get("query") ?? null;
  } catch {
    return null;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Process a social media / search URL end-to-end.
 * Never throws — all errors are caught and result in a graceful empty response.
 */
export async function processSocialLink(
  urlOrText: string,
  warn?: WarnFn,
  dryRun = false,
  clerkUserId = ""
): Promise<ProcessSocialLinkResult> {

  // ── Pre-step: extract URL from mixed text (e.g. Google share format) ──────
  // Handles "Film Title https://share.google/..." sent by Google's share intent.
  let url = urlOrText.trim();
  const mixed = extractUrlFromMixedText(url);
  if (mixed) {
    url = mixed.url;
    if (mixed.titleHint) {
      warn?.({ url, titleHint: mixed.titleHint }, "processSocialLink: mixed-text share detected — trying title as search query first");
      try {
        const { matches, saved, listTitle } = await runMoviePipeline(mixed.titleHint, warn, dryRun, clerkUserId);
        if (matches.length > 0) {
          warn?.({ matchCount: matches.length }, "processSocialLink: title text pipeline succeeded");
          return { source: "caption", text: mixed.titleHint, matches, saved, listTitle };
        }
        warn?.({ titleHint: mixed.titleHint }, "processSocialLink: title text pipeline returned no matches — continuing with URL");
      } catch (err) {
        warn?.({ titleHint: mixed.titleHint, err }, "processSocialLink: title text pipeline failed — continuing with URL");
      }
    }
  }

  // ── Step 0: Google / Bing search URL (fast path) ──────────────────────────
  const searchQuery = extractSearchQuery(url);
  if (searchQuery) {
    warn?.({ url, searchQuery }, "processSocialLink: search URL detected — running text pipeline on query");
    try {
      const { matches, saved, listTitle } = await runMoviePipeline(searchQuery, warn, dryRun, clerkUserId);
      warn?.({ matchCount: matches.length }, "processSocialLink: search query pipeline complete");
      return { source: "caption", text: searchQuery, matches, saved, listTitle };
    } catch (err) {
      warn?.({ url, searchQuery, err }, "processSocialLink: search query pipeline failed");
      return { source: "none", text: searchQuery, matches: [], saved: [], listTitle: null };
    }
  }

  // ── Step 1: Gemini + Google Search grounding ──────────────────────────────
  // Gemini looks up what this URL is about and extracts film references.
  // Replaces platform-specific scrapers — works for any publicly indexed URL.
  try {
    const { movies: matches, list_title: listTitle } = await analyzeUrlForFilms(url);
    warn?.({ url, matchCount: matches.length, matches }, "processSocialLink: Gemini URL analysis complete");

    if (matches.length > 0) {
      const { matches: enriched, saved, listTitle: enrichedListTitle } =
        await enrichAndSaveMatches(matches, warn, dryRun, clerkUserId, listTitle);
      return { source: "caption", text: null, matches: enriched, saved, listTitle: enrichedListTitle };
    }

    warn?.({ url }, "processSocialLink: Gemini URL analysis returned no matches — falling back to audio");
  } catch (err) {
    warn?.({ url, err }, "processSocialLink: Gemini URL analysis failed — falling back to audio");
  }

  // ── Step 2: yt-dlp audio fallback ────────────────────────────────────────
  // For private posts, very new content, or anything Gemini's search index
  // hasn't indexed yet — download the audio and analyse it directly. Only
  // catches films that are actually narrated aloud.
  try {
    const { movies: audioMatches, list_title: audioListTitle } = await extractMoviesFromAudio(url);
    warn?.({ url, matchCount: audioMatches.length }, "processSocialLink: audio extraction complete");

    if (audioMatches.length > 0) {
      const { matches, saved, listTitle } =
        await enrichAndSaveMatches(audioMatches, warn, dryRun, clerkUserId, audioListTitle);
      return { source: "audio", text: null, matches, saved, listTitle };
    }

    warn?.({ url }, "processSocialLink: audio extraction returned no matches — falling back to video");
  } catch (err) {
    warn?.({ url, err }, "processSocialLink: audio extraction failed — falling back to video");
  }

  // ── Step 3: yt-dlp video fallback ────────────────────────────────────────
  // Catches silent "Top N" countdown posts where the list is shown as
  // on-screen text/graphics with no voiceover — audio-only (step 2) misses
  // these entirely. Slower and costlier, so it's the last resort.
  try {
    const { movies: videoMatches, list_title: videoListTitle } = await extractMoviesFromVideo(url);
    warn?.({ url, matchCount: videoMatches.length }, "processSocialLink: video extraction complete");

    const { matches, saved, listTitle } =
      await enrichAndSaveMatches(videoMatches, warn, dryRun, clerkUserId, videoListTitle);
    return { source: "video", text: null, matches, saved, listTitle };
  } catch (err) {
    warn?.({ url, err }, "processSocialLink: video extraction failed — no data available");
  }

  // ── Step 4: nothing worked ────────────────────────────────────────────────
  return { source: "none", text: null, matches: [], saved: [], listTitle: null };
}
