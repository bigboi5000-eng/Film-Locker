/**
 * previewImageExtractor.ts
 *
 * Reads films out of a post's preview image — the `og:image` a platform
 * publishes for link previews.
 *
 * This exists because of what Instagram will and will not serve. Inspecting
 * a reel from the deployed server returns 777KB of HTML with no `og:video`,
 * no mp4 URL anywhere in it, and no embedded comments, while yt-dlp is
 * refused the media outright. A post whose caption names no film therefore
 * had nothing left to try.
 *
 * The cover image is the exception. It sits on Instagram's CDN behind a
 * plain signed URL that an ordinary GET fetches without complaint, and on a
 * film account that frame is usually a still from the film itself, very
 * often with the title set over it. The image extractor already reads both —
 * printed titles and recognisable stills — so this is a fetch and a base64
 * away from an answer the pipeline could not otherwise reach.
 */
import { extractMoviesFromImage, SUPPORTED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "./imageExtractor";
import { fetchPagePreviewImage } from "./pageCaptionScraper";
import type { GeminiExtractionResult } from "./geminiParser";

/** Give up rather than hold the request open for a slow CDN. */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Map a CDN response's content type to something the extractor accepts.
 * Instagram serves jpeg; the extension is the fallback for anything that
 * reports a bare "application/octet-stream".
 */
function resolveMimeType(contentType: string | null, url: string): string | null {
  const reported = contentType?.split(";")[0]?.trim().toLowerCase();
  if (reported && SUPPORTED_IMAGE_TYPES[reported]) return reported;

  const extension = new URL(url).pathname.split(".").pop()?.toLowerCase();
  const byExtension: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
  };
  return extension ? byExtension[extension] ?? null : null;
}

/**
 * Fetch `url`'s preview image and extract any films visible in it.
 *
 * Returns null when there is no preview image, when it cannot be fetched or
 * is not an image type Gemini accepts, or when it is implausibly large. Only
 * a Gemini failure throws, so the caller can distinguish "nothing here" from
 * "the model refused" and fall through accordingly.
 */
export async function extractMoviesFromPreviewImage(
  url: string
): Promise<GeminiExtractionResult | null> {
  const imageUrl = await fetchPagePreviewImage(url);
  if (!imageUrl) return null;
  return extractMoviesFromImageUrl(imageUrl);
}

/**
 * Fetch an image by URL and extract any films visible in it.
 *
 * Split out from the function above because the image does not always come
 * from scraping the page ourselves: Apify returns a reel's cover frame as a
 * plain CDN URL, and that arrives already in hand. Same fetch, same guards,
 * same extractor — only the source of the URL differs.
 *
 * Returns null when the image cannot be fetched, is not a type Gemini
 * accepts, or is implausibly large. Only a Gemini failure throws.
 */
export async function extractMoviesFromImageUrl(
  imageUrl: string
): Promise<GeminiExtractionResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let bytes: ArrayBuffer;
  let mimeType: string | null;
  try {
    const res = await fetch(imageUrl, { signal: controller.signal });
    if (!res.ok) return null;

    mimeType = resolveMimeType(res.headers.get("content-type"), imageUrl);
    if (!mimeType) return null;

    bytes = await res.arrayBuffer();
  } catch {
    // A CDN refusal, a timeout, a malformed URL — all of them mean this
    // route found nothing, which is not an error the caller needs to know
    // the shape of.
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;

  return extractMoviesFromImage(Buffer.from(bytes).toString("base64"), mimeType);
}
