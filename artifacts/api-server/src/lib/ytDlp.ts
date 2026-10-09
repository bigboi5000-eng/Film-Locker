/**
 * ytDlp.ts
 *
 * The bits of yt-dlp invocation that audioExtractor.ts and videoExtractor.ts
 * both need: where the binary is, and whether we have cookies for it.
 *
 * Cookies matter because Instagram periodically stops serving media to
 * anonymous requests from this server. yt-dlp reports it as a rate limit:
 *
 *   WARNING: [Instagram] <id>: Instagram API is not granting access
 *   ERROR: [Instagram] <id>: The webpage request was redirected to the
 *   login page. You have exceeded the rate-limit for accessing posts
 *   anonymously. Use --cookies-from-browser or --cookies [...]
 *
 * The operative part is the redirect to the login page, not the word
 * "rate-limit". The block is real but temporary, and while it is up it takes
 * the caption scrape and the preview image with it, because those read the
 * same page (see fetchPageHtml in pageCaptionScraper.ts) — so a reel that
 * fails every route at once is more likely one page nobody could read than
 * three separate dead ends.
 *
 * Hence the back-off below rather than giving up on the download routes:
 * an earlier version of this skipped them outright on Instagram, which
 * stopped the wasted attempts but also meant never noticing the block had
 * lifted. Cookies remove the problem, for whoever is willing to supply them.
 *
 * Supplying cookies is a deliberate choice, not a default, which is why
 * this only reads them from the environment and never tries to obtain them.
 * They are a logged-in session: whoever's account they belong to carries
 * the risk of Instagram treating datacenter traffic as a compromised
 * login, and the file is as sensitive as a password.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Path to the yt-dlp binary: an explicit override, else the pip --user
 * install location the Dockerfile puts it in, else whatever is on PATH.
 */
export function ytDlpBin(): string {
  if (process.env["YT_DLP_PATH"]) return process.env["YT_DLP_PATH"];
  const home = process.env["HOME"] ?? "/root";
  const localBin = join(home, ".local", "bin", "yt-dlp");
  if (existsSync(localBin)) return localBin;
  return "yt-dlp";
}

/**
 * The cookie file, if one is configured and actually present.
 *
 * The existence check is deliberate: a variable pointing at a file that is
 * not there would otherwise turn every download into a yt-dlp argument
 * error, which is a worse failure than the anonymous attempt it replaced.
 */
function cookieFile(): string | null {
  const path = process.env["YT_DLP_COOKIES_FILE"];
  if (!path) return null;
  if (!existsSync(path)) return null;
  return path;
}

/** Whether media downloads can be authenticated. */
export function hasYtDlpCookies(): boolean {
  return cookieFile() !== null;
}

/** `--cookies <file>` when one is configured, otherwise nothing. */
export function ytDlpCookieArgs(): string[] {
  const path = cookieFile();
  return path ? ["--cookies", path] : [];
}

// ── Instagram media back-off ──────────────────────────────────────────────────
//
// Instagram's refusal is not permanent and not a property of the code: it
// redirects this server's requests to the login page for a while, then
// stops. Skipping the download routes for good — which is what the first
// version of this did — trades three wasted timeouts per reel for never
// recovering when the block lifts, and that is the worse side of the trade,
// because the download is the only route that reads the video itself.
//
// So it backs off instead. The first Instagram reel after the window expires
// tries the download; if that attempt is refused, the next half hour skips
// it. One reel pays for the discovery and the rest go straight to the routes
// that work.
//
// Deliberately in-process and not persisted: it resets on deploy, which is
// when the IP or the yt-dlp version may well have changed anyway, and an
// empty back-off only ever costs one extra attempt.

const BLOCK_BACKOFF_MS = 30 * 60_000;

let instagramBlockedUntil = 0;

/** Whether a recent download was refused and the back-off is still running. */
export function instagramMediaBlocked(): boolean {
  return Date.now() < instagramBlockedUntil;
}

/** Start the back-off window after a refusal. */
export function noteInstagramMediaBlocked(): void {
  instagramBlockedUntil = Date.now() + BLOCK_BACKOFF_MS;
}

/**
 * Whether a yt-dlp failure is Instagram turning the request away rather than
 * something about this particular post.
 *
 * Matched on the message because that is all yt-dlp gives us: it exits
 * non-zero with the text below on stderr, with no distinct status code for
 * "blocked" as against "this post does not exist".
 */
export function looksLikeInstagramRefusal(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return [
    "redirected to the login page",
    "rate-limit for accessing posts anonymously",
    "Instagram API is not granting access",
    "empty media response",
    "login required",
  ].some((marker) => message.toLowerCase().includes(marker.toLowerCase()));
}
