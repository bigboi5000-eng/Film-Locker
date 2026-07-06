/**
 * socialScraper.ts
 *
 * Fetches the text caption from an Instagram or TikTok post using RapidAPI
 * scrapers. Returns null (not an error) when the post has no caption text,
 * so the caller can fall back to audio transcription.
 *
 * Platform routing:
 *   instagram.com  →  instagram-scraper-stable-api.p.rapidapi.com
 *                     Endpoint waterfall (first success wins):
 *                       1. GET /get_media_data_v2.php  (recommended by API)
 *                       2. GET /get_media_data.php     (legacy)
 *                       3. GET /get_reel_title.php     (lighter fallback)
 *   tiktok.com     →  tiktok-scraper7.p.rapidapi.com
 *   anything else  →  null (let the audio fallback handle it)
 */

const RAPIDAPI_KEY = process.env["RAPIDAPI_KEY"];
const IG_HOST = "instagram-scraper-stable-api.p.rapidapi.com";

// All Instagram endpoints to try, in priority order.
const IG_ENDPOINTS = [
  "get_media_data_v2.php",
  "get_media_data.php",
  "get_reel_title.php",
] as const;

type Platform = "instagram" | "tiktok" | "unknown";

function detectPlatform(url: string): Platform {
  try {
    const { hostname } = new URL(url);
    if (hostname.includes("instagram.com")) return "instagram";
    if (hostname.includes("tiktok.com")) return "tiktok";
    return "unknown";
  } catch {
    return "unknown";
  }
}

function requireApiKey(): string {
  if (!RAPIDAPI_KEY) {
    throw new Error(
      "RAPIDAPI_KEY is not set. Add it to Replit Secrets and restart the server."
    );
  }
  return RAPIDAPI_KEY;
}

/**
 * Detect whether an Instagram URL is a reel or a regular post.
 * Defaults to "post" for unknown shapes (IGTV, carousels, etc.).
 */
function igType(url: string): "post" | "reel" {
  return url.includes("/reel/") ? "reel" : "post";
}

// Known generic page-title strings returned by the scraper that are NOT
// actual post captions and must be ignored.
const IG_JUNK_TITLES = new Set(["instagram", "instagram - photos and videos"]);

/**
 * Walk the response JSON looking for a non-empty caption/title string.
 * Instagram's API can return data under several different shapes depending
 * on which endpoint and version was hit, so we probe the common locations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractIgCaption(data: any): string | null {
  // post_caption is the explicit caption field from get_reel_title.php —
  // check it first before falling back to the generic title/description.
  const candidates: unknown[] = [
    data?.post_caption,
    data?.caption,
    data?.data?.caption,
    data?.media?.caption?.text,
    data?.node?.edge_media_to_caption?.edges?.[0]?.node?.text,
    data?.edge_media_to_caption?.edges?.[0]?.node?.text,
    data?.graphql?.shortcode_media?.edge_media_to_caption?.edges?.[0]?.node?.text,
    data?.data?.description,
    data?.description,
    data?.text,
    data?.data?.title,
    // title is last — it's often just "Instagram" (browser page title)
    data?.title,
  ];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const trimmed = c.trim();
    // Skip empty strings and known junk titles
    if (trimmed.length === 0) continue;
    if (IG_JUNK_TITLES.has(trimmed.toLowerCase())) continue;
    return trimmed;
  }
  return null;
}

/**
 * Call one Instagram Scraper Stable API endpoint and return the raw JSON,
 * or null if the response contains an `error` field (post inaccessible).
 * Throws on HTTP errors so the caller can decide whether to try the fallback.
 */
async function igRequest(
  key: string,
  path: string,
  url: string
): Promise<Record<string, unknown> | null> {
  const type = igType(url);
  const endpoint = `https://${IG_HOST}/${path}?reel_post_code_or_url=${encodeURIComponent(url)}&type=${type}`;

  const res = await fetch(endpoint, {
    headers: {
      "x-rapidapi-key": key,
      "x-rapidapi-host": IG_HOST,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Instagram scraper (${path}) returned ${res.status} ${res.statusText}: ${body.slice(0, 200)}`
    );
  }

  const data = await res.json() as Record<string, unknown>;
  // API signals "not found" or "rate limited" via an `error` field rather
  // than an HTTP error status — treat any non-null error value as failure.
  if (data?.error != null) return null;
  return data;
}

/** Fetch caption for an Instagram post/reel URL, trying each endpoint in turn. */
async function fetchInstagramCaption(url: string): Promise<string | null> {
  const key = requireApiKey();

  for (const path of IG_ENDPOINTS) {
    try {
      const data = await igRequest(key, path, url);
      if (!data) continue; // API-level error on this endpoint — try next
      const caption = extractIgCaption(data);
      if (caption) return caption;
      // Data returned but no caption found — still try the next endpoint
      // in case it carries different fields.
    } catch {
      // Network / HTTP error on this endpoint — fall through to next
    }
  }

  return null;
}

/** Fetch caption/description for a TikTok video URL. */
async function fetchTikTokCaption(url: string): Promise<string | null> {
  const key = requireApiKey();
  const endpoint = `https://tiktok-scraper7.p.rapidapi.com/post?url=${encodeURIComponent(url)}`;

  const res = await fetch(endpoint, {
    headers: {
      "x-rapidapi-key": key,
      "x-rapidapi-host": "tiktok-scraper7.p.rapidapi.com",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `TikTok scraper returned ${res.status} ${res.statusText}: ${body.slice(0, 200)}`
    );
  }

  const data = await res.json() as { data?: { desc?: string | null } };
  // Shape: { data: { desc: string, ... } }
  const desc: string | null = data?.data?.desc ?? null;
  return desc && desc.trim().length > 0 ? desc.trim() : null;
}

/**
 * Attempt to fetch a text caption from the social post at `url`.
 *
 * Returns:
 *   - A non-empty caption string on success.
 *   - null when the post has no caption or the platform is unsupported
 *     (caller should fall back to audio transcription).
 *
 * Throws on network / API key errors so the caller can log and decide.
 */
export async function fetchSocialCaption(url: string): Promise<string | null> {
  const platform = detectPlatform(url);

  if (platform === "instagram") return fetchInstagramCaption(url);
  if (platform === "tiktok") return fetchTikTokCaption(url);

  // Unknown platform — caption not available via RapidAPI; return null so
  // the caller can proceed to audio transcription via yt-dlp.
  return null;
}

export interface InstagramDebugResult {
  platform: Platform;
  igType: "post" | "reel";
  endpoints: {
    name: string;
    url: string;
    status: number | null;
    rawJson: unknown;
    error: string | null;
  }[];
  extractedCaption: string | null;
}

/**
 * Debug variant of fetchInstagramCaption that returns raw API responses
 * alongside the extracted caption, so callers can inspect every step.
 */
export async function debugInstagramScrape(url: string): Promise<InstagramDebugResult> {
  const platform = detectPlatform(url);
  const type = igType(url);
  const result: InstagramDebugResult = {
    platform,
    igType: type,
    endpoints: [],
    extractedCaption: null,
  };

  if (platform !== "instagram") return result;

  const key = requireApiKey();

  for (const path of IG_ENDPOINTS) {
    const endpointUrl = `https://${IG_HOST}/${path}?reel_post_code_or_url=${encodeURIComponent(url)}&type=${type}`;
    const entry: InstagramDebugResult["endpoints"][number] = {
      name: path,
      url: endpointUrl,
      status: null,
      rawJson: null,
      error: null,
    };

    try {
      const res = await fetch(endpointUrl, {
        headers: { "x-rapidapi-key": key, "x-rapidapi-host": IG_HOST },
      });
      entry.status = res.status;

      if (!res.ok) {
        // Try to get structured JSON even for error responses
        const bodyText = await res.text().catch(() => "");
        try { entry.rawJson = JSON.parse(bodyText); } catch { /* ignore */ }
        entry.error = `HTTP ${res.status} ${res.statusText}: ${bodyText.slice(0, 300)}`;
      } else {
        const data = await res.json() as Record<string, unknown>;
        entry.rawJson = data;
        // Always annotate API-level errors regardless of caption state
        if (data?.error != null) {
          entry.error = `API error field: ${JSON.stringify(data.error).slice(0, 200)}`;
        } else {
          // Only pick the caption from the first endpoint that has one
          if (result.extractedCaption === null) {
            const caption = extractIgCaption(data);
            if (caption) result.extractedCaption = caption;
          }
        }
      }
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err);
    }

    result.endpoints.push(entry);
  }

  return result;
}
