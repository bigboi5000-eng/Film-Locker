/**
 * pageCaptionScraper.ts
 *
 * Free, dependency-free caption fetch via direct HTML scrape — no API key,
 * no per-request cost. Tried first in processSocialLink.ts, before the
 * Gemini + Google Search grounding step.
 *
 * This exists because Gemini's Google Search grounding does not reliably
 * have Instagram post captions indexed (Meta's login walls keep much of it
 * out of Google's index), even though Instagram embeds the caption directly
 * in the page's `og:description` meta tag for public posts — a plain HTTP
 * GET picks that up without needing Google to have crawled it at all.
 *
 * Deliberately does NOT call any paid third-party API (e.g. RapidAPI) —
 * that was tried previously, cost money per call, and was unreliable
 * (endpoints going "under maintenance", aggressive rate limits). If this
 * free scrape finds nothing, the caller falls through to Gemini URL
 * grounding, then the audio/video fallbacks.
 */

export type Platform = "instagram" | "tiktok" | "youtube" | "facebook" | "unknown";

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

/** Decode HTML entities so caption text is clean before sending to Gemini. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // Decimal numeric entities — use fromCodePoint for full Unicode (emoji etc.)
    .replace(/&#(\d+);/g, (_, n) => {
      const cp = Number(n);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const cp = parseInt(h, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
    });
}

/**
 * Pull a <meta property="…" content="…"> value from raw HTML.
 * Attribute-order and quote-style agnostic.
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
 * Fetch the Instagram page HTML and extract the caption from og:description.
 *
 * Instagram renders og:description for public posts without requiring login:
 * typically "22K likes, 167 comments - username on date: "caption text"".
 * We send the full string to Gemini — it handles the preamble fine.
 */
async function fetchInstagramCaption(url: string): Promise<string | null> {
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

  if (
    html.includes("Log in to Instagram") ||
    html.includes("loginForm") ||
    html.includes('"requiresLogin":true')
  ) {
    return null;
  }

  const raw = extractMetaContent(html, "og:description");
  if (!raw) return null;

  const decoded = decodeHtmlEntities(raw).trim();
  if (decoded.toLowerCase().includes("log in to instagram")) return null;

  return decoded.length > 0 ? decoded : null;
}

/**
 * Generic og:title + og:description scraper for platforms that don't need
 * bespoke handling — YouTube, Facebook, TikTok public pages all embed these.
 */
async function fetchGenericOgCaption(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        // Googlebot UA often gets cleaner HTML than a mobile UA, and avoids
        // consent-gate redirects on some Facebook pages.
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

/**
 * Attempt to fetch caption/description text for `url` via a plain HTTP GET —
 * free, fast, no API key. Returns null (not an error) when nothing useful is
 * found, so the caller falls through to Gemini URL grounding.
 */
export async function fetchPageCaption(url: string): Promise<string | null> {
  const platform = detectPlatform(url);

  try {
    if (platform === "instagram") {
      const caption = await fetchInstagramCaption(url);
      if (caption) return caption;
      // Instagram sometimes still exposes a generic og:description even when
      // the dedicated parse above finds nothing — cheap to try as a fallback.
      return await fetchGenericOgCaption(url);
    }
    return await fetchGenericOgCaption(url);
  } catch {
    return null;
  }
}
