/**
 * processSocialLink.ts
 *
 * Main entry point fired whenever a user submits a social media URL.
 *
 * Strategy:
 *   1. Try RapidAPI caption scraper (fast, free-tier friendly).
 *   2. If caption is absent/empty, download audio with yt-dlp and transcribe
 *      via OpenAI Whisper (audio fallback).
 *   3. Feed whichever text is available into the Gemini → TMDB → DB pipeline.
 *   4. If neither source yields text, return an empty result instead of throwing.
 *
 * The `source` field in the result tells the caller how text was obtained so
 * the UI can display a meaningful label ("from caption" vs "from audio").
 */

import { fetchSocialCaption } from "./socialScraper";
import { transcribeAudio } from "./audioTranscriber";
import { runMoviePipeline, type PipelineResult } from "./moviePipeline";

export type SocialLinkSource = "caption" | "transcript" | "none";

export interface ProcessSocialLinkResult extends PipelineResult {
  source: SocialLinkSource;
  /** The raw text that was sent to Gemini; null when no text could be obtained. */
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
  let text: string | null = null;
  let source: SocialLinkSource = "none";

  // ── Step 1: caption via RapidAPI ──────────────────────────────────────────
  try {
    text = await fetchSocialCaption(url);
    if (text) {
      source = "caption";
    }
  } catch (err) {
    warn?.({ url, err }, "processSocialLink: caption fetch failed — trying audio fallback");
  }

  // ── Step 2: audio fallback via yt-dlp + Whisper ───────────────────────────
  if (!text) {
    try {
      text = await transcribeAudio(url);
      if (text) {
        source = "transcript";
      }
    } catch (err) {
      warn?.({ url, err }, "processSocialLink: audio transcription failed — no text available");
    }
  }

  // ── Step 3: no text from either source ────────────────────────────────────
  if (!text) {
    return { source: "none", text: null, matches: [], saved: [] };
  }

  // ── Step 4: Gemini → TMDB → DB ────────────────────────────────────────────
  try {
    const { matches, saved } = await runMoviePipeline(text, warn);
    return { source, text, matches, saved };
  } catch (err) {
    warn?.({ url, err }, "processSocialLink: Gemini pipeline failed — returning empty matches");
    return { source, text, matches: [], saved: [] };
  }
}
