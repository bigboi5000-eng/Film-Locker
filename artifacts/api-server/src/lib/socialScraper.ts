/**
 * socialScraper.ts
 *
 * Fetches the text caption from an Instagram or TikTok post.
 * Returns null (not an error) when no caption is found, so the caller
 * can fall back to audio transcription.
 *
 * Instagram waterfall (first success wins):
 *   1. Direct HTML scrape — extracts og:description from the public page.
 *      No API key needed; works for any public post. Primary approach.
 *   2. RapidAPI get_media_data_v2.php  (recommended by API, but intermittent)
 *   3. RapidAPI get_media_data.php     (legacy)
 *   4. RapidAPI get_reel_title.php     (lighter fallback)
 *
 * TikTok:
 *   RapidAPI tiktok-scraper7.p.rapidapi.com
 */

const RAPIDAPI_KEY = process.env["RAPIDAPI_KEY"];
const IG_HOST = "instagram-scraper-stable-api.p.rapidapi.com";

// RapidAPI Instagram endpoints, tried in order after the HTML scrape fails.
const IG_RAPIDAPI_ENDPOINTS = [
  "get_media_data_v2.php",
  "get_media_data.php",
  "get_reel_title.php",
] as const;

type Platform = "instagram" | "tiktok" | "youtube" | "facebook" | "unknown";

export function detectPlatform(url: string): Platform {
  try {
    const { hostname } = new URL(url);
    if (hostname.includes("instagram.com")) return "instagram";
    if (hostname.includes("tiktok.com")) return "tiktok";
    if (hostname.includes("youtube.com") || hostname === "youtu.be" || hostname.endsWith(".youtu.be")) return "youtube";
    if (hostname.includes("facebook.com") || hostname.includes("fb.com") || hostname.includes("fb.watch")) return "facebook";
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

/** Detect whether an Instagram URL is a reel or a regular post. */
function igType(url: string): "post" | "reel" {
  return url.includes("/reel/") ? "reel" : "post";
}

/**
 * Pull a <meta property="…" content="…"> value from raw HTML.
 * Used for og:title / og:description on YouTube and Facebook public pages.
 */
function extractMetaContent(html: string, property: string): string | null {
  const metaRe = /<meta\s[^>]+>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html)) !== null) {
    const tag = m[0];
    if (!tag.toLowerCase().includes(property.toLowerCase())) continue;
    const contentMatch =
      tag.match(/content=["']([\s\S]*?)["']/i) ??
      tag.match(/content=(["'])([\s\S]*?)\1/i);
    const val = (contentMatch?.[2] ?? contentMatch?.[1] ?? "").trim();
    if (val.length > 0) return val;
  }
  return null;
}

/**
 * Generic og:title + og:description scraper.
 *
 * Works for any public page that embeds Open Graph meta tags —
 * currently used for YouTube and Facebook. Both title and description
 * are concatenated and sent to Gemini so it has maximum context.
 *
 * YouTube example:
 *   og:title    = "Inception – Explained (2010)"
 *   og:description = "Today we break down Christopher Nolan's Inception…"
 *
 * Facebook example (public posts):
 *   og:title    = "Rotten Tomatoes"
 *   og:description = "Score for The Godfather (1972): 98%"
 */
async function fetchPageOgCaption(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        // Googlebot UA often gets cleaner HTML from YouTube/Facebook than a
        // mobile UA, and avoids consent-gate redirects on some Facebook pages.
        "User-Agent":
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!res.ok) return null;
    const html = await res.text();

    const title = extractMetaContent(html, "og:title");
    const description = extractMetaContent(html, "og:description");

    const parts = [title, description].filter(Boolean) as string[];
    if (parts.length === 0) return null;

    const combined = decodeHtmlEntities(parts.join("\n")).trim();
    return combined.length > 0 ? combined : null;
  } catch {
    return null;
  }
}

/** Decode HTML entities so caption text is clean before sending to Gemini. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // Decimal numeric entities — use codePointAt-safe fromCodePoint for full Unicode
    .replace(/&#(\d+);/g, (_, n) => {
      const cp = Number(n);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
    })
    // Hex numeric entities
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const cp = parseInt(h, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
    });
}

/**
 * Fetch the Instagram page HTML and extract the caption from og:description.
 *
 * Instagram renders og:description for public posts without requiring login.
 * The value is typically: "22K likes, 167 comments - username on date: "caption text""
 * We send the full string to Gemini — it handles the preamble fine.
 */
async function fetchInstagramHtmlCaption(url: string): Promise<string | null> {
  // Strip tracking params — keep just the canonical reel/post URL
  const canonical = url.split("?")[0].replace(/\/?$/, "/");

  const res = await fetch(canonical, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });

  if (!res.ok) return null;

  // Instagram occasionally redirects unauthenticated requests to the login page.
  // Check the pathname precisely so post shortcodes containing "login" don't
  // produce a false null (e.g. /p/loginXYZ/).
  try {
    const finalPath = new URL(res.url).pathname;
    if (finalPath.startsWith("/accounts/login") || finalPath === "/login") {
      return null;
    }
  } catch {
    // If URL parsing fails, fall through and let the HTML body check decide.
  }

  const html = await res.text();

  // Bail if we landed on a login wall
  if (
    html.includes("Log in to Instagram") ||
    html.includes("loginForm") ||
    html.includes('"requiresLogin":true')
  ) {
    return null;
  }

  // Extract og:description robustly regardless of attribute order and quote style.
  // We match the content value up to the closing quote (same style as the opening).
  function extractOgDescription(html: string): string | null {
    // Normalise to find all <meta> tags and look for one with og:description
    const metaRe = /<meta\s[^>]+>/gi;
    let m: RegExpExecArray | null;
    while ((m = metaRe.exec(html)) !== null) {
      const tag = m[0];
      if (!/og:description/i.test(tag)) continue;
      // Extract content="..." or content='...' — respecting the opening quote
      const contentMatch =
        tag.match(/content=["']([\s\S]*?)["']\s*(?:\/?>|\w)/i) ??
        tag.match(/content=(["'])([\s\S]*?)\1/i);
      const val = contentMatch?.[2] ?? contentMatch?.[1] ?? null;
      if (val && val.trim().length > 0) return val.trim();
    }
    return null;
  }

  const raw = extractOgDescription(html);

  if (!raw || raw.trim().length === 0) return null;

  const decoded = decodeHtmlEntities(raw).trim();

  // Reject obviously empty or login-wall placeholders
  if (decoded.toLowerCase().includes("log in to instagram")) return null;

  return decoded;
}

// Known generic page-title strings returned by RapidAPI that are NOT captions.
const IG_JUNK_TITLES = new Set(["instagram", "instagram - photos and videos"]);

/**
 * Walk the RapidAPI response JSON looking for a non-empty caption string.
 * Different endpoints return data under different keys, so we probe all known locations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractIgCaption(data: any): string | null {
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
    if (trimmed.length === 0) continue;
    if (IG_JUNK_TITLES.has(trimmed.toLowerCase())) continue;
    return trimmed;
  }
  return null;
}

/**
 * Call one RapidAPI Instagram endpoint and return the raw JSON,
 * or null if the response carries an error field.
 * Throws on HTTP errors so the caller can fall through to the next endpoint.
 */
async function igRapidApiRequest(
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

  const data = (await res.json()) as Record<string, unknown>;
  // Treat any non-null error field as a failure (API uses error strings, objects, etc.)
  if (data?.error != null) return null;
  return data;
}

/**
 * Fetch the caption for an Instagram post/reel URL.
 *
 * Waterfall:
 *   1. Direct HTML scrape of og:description (primary — no rate limits, no API key)
 *   2. RapidAPI endpoints (fallback, tried in order)
 */
async function fetchInstagramCaption(url: string): Promise<string | null> {
  // ── 1. HTML scrape (primary) ──────────────────────────────────────────────
  try {
    const caption = await fetchInstagramHtmlCaption(url);
    if (caption) return caption;
  } catch {
    // Network error — fall through to RapidAPI
  }

  // ── 2. RapidAPI fallback ──────────────────────────────────────────────────
  const key = requireApiKey();

  for (const path of IG_RAPIDAPI_ENDPOINTS) {
    try {
      const data = await igRapidApiRequest(key, path, url);
      if (!data) continue;
      const caption = extractIgCaption(data);
      if (caption) return caption;
    } catch {
      // This endpoint failed — try next
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

  const data = (await res.json()) as { data?: { desc?: string | null } };
  const desc: string | null = data?.data?.desc ?? null;
  return desc && desc.trim().length > 0 ? desc.trim() : null;
}

/**
 * Attempt to fetch a text caption from the social post at `url`.
 *
 * Returns a non-empty caption string on success, or null when nothing is found
 * (caller should fall back to audio transcription).
 *
 * Throws on unrecoverable errors (bad API key, etc.).
 */
export async function fetchSocialCaption(url: string): Promise<string | null> {
  const platform = detectPlatform(url);

  if (platform === "instagram") return fetchInstagramCaption(url);
  if (platform === "tiktok") return fetchTikTokCaption(url);
  // YouTube and Facebook: og:title + og:description from the public page.
  // If the scrape fails or returns nothing, processSocialLink falls back to
  // yt-dlp audio extraction automatically.
  if (platform === "youtube" || platform === "facebook") return fetchPageOgCaption(url);

  return null;
}

// ── Debug helpers ──────────────────────────────────────────────────────────────

export interface InstagramDebugResult {
  platform: Platform;
  igType: "post" | "reel";
  htmlScrape: {
    url: string;
    caption: string | null;
    error: string | null;
  };
  rapidApiEndpoints: {
    name: string;
    url: string;
    status: number | null;
    rawJson: unknown;
    error: string | null;
  }[];
  extractedCaption: string | null;
}

/**
 * Debug variant that returns every intermediate value so the caller can see
 * exactly which step succeeded or failed.
 */
export async function debugInstagramScrape(url: string): Promise<InstagramDebugResult> {
  const platform = detectPlatform(url);
  const type = igType(url);
  const result: InstagramDebugResult = {
    platform,
    igType: type,
    htmlScrape: { url: url.split("?")[0].replace(/\/?$/, "/"), caption: null, error: null },
    rapidApiEndpoints: [],
    extractedCaption: null,
  };

  if (platform !== "instagram") return result;

  // ── HTML scrape ──────────────────────────────────────────────────────────
  try {
    const caption = await fetchInstagramHtmlCaption(url);
    result.htmlScrape.caption = caption;
    if (caption) result.extractedCaption = caption;
  } catch (err) {
    result.htmlScrape.error = err instanceof Error ? err.message : String(err);
  }

  // ── RapidAPI endpoints ───────────────────────────────────────────────────
  const key = requireApiKey();

  for (const path of IG_RAPIDAPI_ENDPOINTS) {
    const endpointUrl = `https://${IG_HOST}/${path}?reel_post_code_or_url=${encodeURIComponent(url)}&type=${type}`;
    const entry: InstagramDebugResult["rapidApiEndpoints"][number] = {
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
        const bodyText = await res.text().catch(() => "");
        try { entry.rawJson = JSON.parse(bodyText); } catch { /* ignore */ }
        entry.error = `HTTP ${res.status} ${res.statusText}: ${bodyText.slice(0, 300)}`;
      } else {
        const data = (await res.json()) as Record<string, unknown>;
        entry.rawJson = data;
        if (data?.error != null) {
          entry.error = `API error field: ${JSON.stringify(data.error).slice(0, 200)}`;
        } else if (result.extractedCaption === null) {
          const caption = extractIgCaption(data);
          if (caption) result.extractedCaption = caption;
        }
      }
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err);
    }

    result.rapidApiEndpoints.push(entry);
  }

  return result;
}
