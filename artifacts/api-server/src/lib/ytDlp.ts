/**
 * ytDlp.ts
 *
 * The bits of yt-dlp invocation that audioExtractor.ts and videoExtractor.ts
 * both need: where the binary is, and whether we have cookies for it.
 *
 * Cookies matter because Instagram no longer serves media to anonymous
 * requests from a datacenter IP. yt-dlp reports it as a rate limit:
 *
 *   WARNING: [Instagram] <id>: Instagram API is not granting access
 *   ERROR: [Instagram] <id>: The webpage request was redirected to the
 *   login page. You have exceeded the rate-limit for accessing posts
 *   anonymously. Use --cookies-from-browser or --cookies [...]
 *
 * It reads as something that will pass, but it does not: the limit for an
 * unauthenticated cloud IP is effectively zero, and every Instagram media
 * download from the server has failed this way. So processSocialLink.ts
 * checks hasYtDlpCookies() before spending a download attempt on Instagram
 * at all, and falls through to the routes that do work — the caption
 * scrape, the post's preview image, and search grounding.
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
