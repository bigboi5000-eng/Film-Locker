/**
 * socialScraper.ts
 *
 * Fetches the text caption from an Instagram or TikTok post using RapidAPI
 * scrapers. Returns null (not an error) when the post has no caption text,
 * so the caller can fall back to audio transcription.
 *
 * Platform routing:
 *   instagram.com  →  instagram-scraper-api2.p.rapidapi.com
 *   tiktok.com     →  tiktok-scraper7.p.rapidapi.com
 *   anything else  →  null (let the audio fallback handle it)
 */

const RAPIDAPI_KEY = process.env["RAPIDAPI_KEY"];

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

/** Fetch caption for an Instagram post/reel/story URL. */
async function fetchInstagramCaption(url: string): Promise<string | null> {
  const key = requireApiKey();
  const endpoint = `https://instagram-scraper-api2.p.rapidapi.com/v1/post_info?code_or_id_or_url=${encodeURIComponent(url)}`;

  const res = await fetch(endpoint, {
    headers: {
      "x-rapidapi-key": key,
      "x-rapidapi-host": "instagram-scraper-api2.p.rapidapi.com",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Instagram scraper returned ${res.status} ${res.statusText}: ${body.slice(0, 200)}`
    );
  }

  const data = await res.json() as { data?: { caption?: string | null } };
  // Shape: { data: { caption: string | null, ... } }
  const caption: string | null = data?.data?.caption ?? null;
  return caption && caption.trim().length > 0 ? caption.trim() : null;
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
