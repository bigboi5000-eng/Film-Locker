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
 *   0.5. Direct page caption scrape (pageCaptionScraper.ts):
 *        Free HTTP GET for the page's og:description — no API cost, no
 *        Google index dependency. This is the step that actually finds
 *        Instagram/TikTok/YouTube/Facebook captions most reliably, since
 *        Google's index of Instagram in particular is unreliable (login
 *        walls keep much of it out) — step 1 below regularly finds nothing
 *        for Instagram posts that this step picks up directly from the page.
 *
 *   1. Gemini + Google Search grounding (skipped for Instagram and TikTok):
 *        Gemini searches Google to find out what the URL is about, then
 *        identifies any films referenced. Fallback for content the direct
 *        scrape above couldn't reach (private/login-walled pages) or
 *        platforms without a specific scraper. Skipped for Instagram —
 *        Google's index of Instagram is too sparse for this to reliably
 *        find anything, and grounding-by-search asks Gemini to guess at
 *        content it can't verify rather than analyse content it was
 *        actually given. Also skipped for TikTok: TikTok's anti-bot checks
 *        frequently block the step-0.5 scrape when it runs from a cloud
 *        server IP (the same class of block Instagram gets), which used to
 *        route nearly every TikTok link through this step — and Google
 *        Search grounding has a much stricter, separate quota from Gemini's
 *        plain calls, shared across every user and platform. Burning it on
 *        TikTok links starved other platforms that actually depend on it
 *        (Twitter/X, Facebook, generic sites) once it ran out for the day.
 *        TikTok is well supported by yt-dlp, so it goes straight from step
 *        0.5 to the audio/video steps below instead, which is also a more
 *        reliable signal than a web search guessing at the post's content.
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

import { fetchPageCaption, detectPlatform } from "./pageCaptionScraper";
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
 * share.google links are Google's short-link redirector for shared search
 * results — the actual destination is almost always a real
 * google.com/search?q=... page, which extractSearchQuery() below already
 * handles reliably. Without resolving the redirect first, a share.google
 * link falls through to page-caption scraping, Gemini URL grounding, and
 * yt-dlp — none of which have anything real to find on a redirect-only
 * link (yt-dlp in particular gets an outright 429 from Google itself when
 * it tries to treat the short link as a video page, unrelated to any
 * Gemini quota).
 */
async function resolveShareGoogleLink(url: string): Promise<string> {
  try {
    const { hostname } = new URL(url);
    if (!hostname.toLowerCase().endsWith("share.google")) return url;
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    void res.body?.cancel?.();
    return res.url || url;
  } catch {
    return url;
  }
}

/**
 * If the URL is a Google or Bing search results page, return the search query.
 * Otherwise return null so the caller proceeds to Gemini URL analysis.
 *
 * Examples:
 *   https://www.google.com/search?q=inception+2010   → "inception 2010"
 *   https://www.bing.com/search?q=parasite+film      → "parasite film"
 *
 * Also handles Google's automated-traffic block page
 * (google.com/sorry/index?continue=<the real URL you were headed to>&...) —
 * server-side requests to Google Search get this instead of real results
 * disturbingly often. We can't get past the CAPTCHA, but the block page's
 * own `continue` param already contains the real destination URL — including
 * its `q=` search query — so the query is recoverable without ever loading
 * the actual search page.
 */
function extractSearchQuery(url: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();

    if (h.includes("google.") && u.pathname.startsWith("/sorry")) {
      const dest = u.searchParams.get("continue");
      if (!dest) return null;
      try {
        const destUrl = new URL(dest);
        return destUrl.searchParams.get("q") ?? destUrl.searchParams.get("query") ?? null;
      } catch {
        return null;
      }
    }

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
        const { matches, saved, listTitle } = await runMoviePipeline(mixed.titleHint, warn, dryRun, clerkUserId, true);
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

  // A share.google link with no useful title hint (or one Gemini didn't
  // recognize) still needs resolving before the search-URL fast path below
  // has a chance — see resolveShareGoogleLink() for why.
  const resolvedUrl = await resolveShareGoogleLink(url);
  if (resolvedUrl !== url) {
    warn?.({ url, resolvedUrl }, "processSocialLink: resolved share.google redirect");
    url = resolvedUrl;
  }

  // ── Step 0: Google / Bing search URL (fast path) ──────────────────────────
  const searchQuery = extractSearchQuery(url);
  if (searchQuery) {
    warn?.({ url, searchQuery }, "processSocialLink: search URL detected — running text pipeline on query");
    try {
      const { matches, saved, listTitle } = await runMoviePipeline(searchQuery, warn, dryRun, clerkUserId, true);
      warn?.({ matchCount: matches.length }, "processSocialLink: search query pipeline complete");
      return { source: "caption", text: searchQuery, matches, saved, listTitle };
    } catch (err) {
      warn?.({ url, searchQuery, err }, "processSocialLink: search query pipeline failed");
      return { source: "none", text: searchQuery, matches: [], saved: [], listTitle: null };
    }
  }

  // ── Step 0.5: direct page caption scrape (free, no API cost) ─────────────
  // Fetches og:description directly from the page — catches Instagram/TikTok/
  // YouTube/Facebook captions that Google hasn't indexed (Instagram especially).
  try {
    const pageCaption = await fetchPageCaption(url);
    if (pageCaption) {
      warn?.({ url, captionPreview: pageCaption.slice(0, 300) }, "processSocialLink: page caption scrape succeeded");
      const { matches, saved, listTitle } = await runMoviePipeline(pageCaption, warn, dryRun, clerkUserId);
      if (matches.length > 0) {
        warn?.({ matchCount: matches.length }, "processSocialLink: page caption pipeline succeeded");
        return { source: "caption", text: pageCaption, matches, saved, listTitle };
      }
      warn?.({ url }, "processSocialLink: page caption found no films — falling back to Gemini URL grounding");
    } else {
      warn?.({ url }, "processSocialLink: page caption scrape found nothing — falling back to Gemini URL grounding");
    }
  } catch (err) {
    warn?.({ url, err }, "processSocialLink: page caption scrape failed — falling back to Gemini URL grounding");
  }

  // ── Step 1: Gemini + Google Search grounding (skipped for Instagram/TikTok) ─
  // Gemini looks up what this URL is about and extracts film references.
  // Fallback for content the direct scrape above couldn't reach.
  //
  // Instagram is deliberately excluded: Google's index of Instagram is
  // unreliable (login walls keep most of it out), so this step is asking
  // Gemini to search for something it usually can't find — and when it
  // can't verify a match it has previously substituted plausible-sounding
  // content from the creator's other posts instead of reporting nothing
  // (see geminiUrlAnalyzer.ts's FOUND/NOT_FOUND guard). Gemini's job here is
  // to understand actual post content handed to it (caption text, or the
  // downloaded audio/video in steps 2-3 below), not to search the web for
  // the URL.
  //
  // TikTok is also excluded: its anti-bot checks routinely block the free
  // step-0.5 scrape from a cloud server IP, which used to send nearly every
  // TikTok link through this step — and this grounding call draws from a
  // separate, much stricter Google Search quota than Gemini's plain calls,
  // shared across every user and platform. Letting TikTok burn through it
  // starved platforms that actually need it (Twitter/X, Facebook, generic
  // sites) once the daily cap was hit. TikTok downloads reliably via
  // yt-dlp, so it goes straight to the audio/video steps below instead.
  const skipGrounding = detectPlatform(url) === "instagram" || detectPlatform(url) === "tiktok";
  if (!skipGrounding) {
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
  } else {
    warn?.({ url }, "processSocialLink: Instagram/TikTok URL — skipping Gemini search grounding, going straight to audio");
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
