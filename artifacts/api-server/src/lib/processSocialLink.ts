/**
 * processSocialLink.ts
 *
 * Main entry point fired whenever a user submits a social media URL.
 *
 * Strategy:
 *   1. RapidAPI caption scraper (fast, no AI cost).
 *        → text → Gemini text pipeline → TMDB → DB
 *   2. If caption absent/empty: yt-dlp downloads audio, Gemini 2.5 Flash
 *      processes it natively via the Files API (multimodal, no transcription step).
 *        → Gemini audio extraction → TMDB → DB
 *   3. If both fail: return an empty result instead of throwing.
 *
 * Only credential required: GEMINI_API_KEY (and RAPIDAPI_KEY for captions).
 * OpenAI is not used anywhere in this file or its dependencies.
 *
 * The `source` field tells the UI how movies were found:
 *   "caption"   — RapidAPI returned post text → Gemini parsed it
 *   "audio"     — yt-dlp + Gemini native audio understanding
 *   "none"      — neither source yielded usable data
 */

import { fetchSocialCaption } from "./socialScraper";
import { extractMoviesFromAudio } from "./audioExtractor";
import {
  runMoviePipeline,
  enrichAndSaveMatches,
  type PipelineResult,
} from "./moviePipeline";

export type SocialLinkSource = "caption" | "audio" | "none";

export interface ProcessSocialLinkResult extends PipelineResult {
  source: SocialLinkSource;
  /** Raw caption text when source is "caption"; null for audio or none. */
  text: string | null;
}

type WarnFn = (data: Record<string, unknown>, msg: string) => void;

/**
 * Process a social media URL end-to-end:
 * caption / audio → Gemini → TMDB → DB.
 *
 * Never throws — all errors are surfaced via `warn` and result in a graceful
 * empty response, so the route handler always has something to return.
 *
 * @param url   Public social media post URL (Instagram, TikTok, YouTube, etc.)
 * @param warn  Optional structured logger for per-step warnings.
 */
export async function processSocialLink(
  url: string,
  warn?: WarnFn
): Promise<ProcessSocialLinkResult> {
  // ── Step 1: caption via RapidAPI ──────────────────────────────────────────
  try {
    const caption = await fetchSocialCaption(url);

    if (caption) {
      warn?.({ url, captionLength: caption.length, captionPreview: caption.slice(0, 300) }, "processSocialLink: caption fetched — sending to Gemini");
      // Caption found — run through the full text pipeline
      try {
        const { matches, saved } = await runMoviePipeline(caption, warn);
        warn?.({ url, matchCount: matches.length, savedCount: saved.length, matches }, "processSocialLink: Gemini pipeline complete");
        return { source: "caption", text: caption, matches, saved };
      } catch (err) {
        warn?.({ url, err }, "processSocialLink: Gemini text pipeline failed");
        return { source: "caption", text: caption, matches: [], saved: [] };
      }
    } else {
      warn?.({ url }, "processSocialLink: scraper returned no caption — falling back to audio");
    }
  } catch (err) {
    warn?.({ url, err }, "processSocialLink: caption fetch failed — trying audio fallback");
  }

  // ── Step 2: audio fallback via yt-dlp + Gemini native audio ──────────────
  try {
    const audioMatches = await extractMoviesFromAudio(url);

    try {
      const { matches, saved } = await enrichAndSaveMatches(audioMatches, warn);
      return { source: "audio", text: null, matches, saved };
    } catch (err) {
      warn?.({ url, err }, "processSocialLink: TMDB/DB enrichment failed after audio extraction");
      return { source: "audio", text: null, matches: [], saved: [] };
    }
  } catch (err) {
    warn?.({ url, err }, "processSocialLink: audio extraction failed — no data available");
  }

  // ── Step 3: nothing worked ────────────────────────────────────────────────
  return { source: "none", text: null, matches: [], saved: [] };
}
