/**
 * imageExtractor.ts
 *
 * Reads film references out of a still image the user supplies — a photo of
 * a poster or cinema listing, or a screenshot of a post.
 *
 * This exists because every other visual path in the pipeline goes through
 * yt-dlp, which downloads video streams. An image carousel (the "best films
 * of the 1930s" grid that is a staple of film accounts) has no video for
 * yt-dlp to fetch, and the titles in it are burned into the pixels rather
 * than written in the caption — so the caption scrape finds nothing either,
 * and the post falls through the whole pipeline to "no film identified".
 *
 * Taking the image directly from the user also sidesteps the anti-bot
 * blocking that stops the server scraping Instagram and TikTok from a cloud
 * IP: the pixels are handed to us rather than fetched.
 *
 * Flow mirrors audioExtractor/videoExtractor:
 *   1. Decode base64 → /tmp/film-locker-image-<uuid>.<ext>
 *   2. uploadAndAnalyzeMedia() (geminiMediaExtractor.ts)
 *   3. Local temp file deleted in a finally block
 *
 * Only credential required: GEMINI_API_KEY.
 */

import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import type { GeminiExtractionResult } from "./geminiParser";
import { uploadAndAnalyzeMedia } from "./geminiMediaExtractor";

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  if (!_client) _client = new GoogleGenAI({ apiKey });
  return _client;
}

/** Image types Gemini accepts, mapped to the extension for the temp file. */
export const SUPPORTED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

/**
 * Decoded image bytes are capped well below what Gemini accepts. A phone
 * photo compressed by the picker lands far under this; anything larger is
 * more likely a mistake than a film poster.
 */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const IMAGE_PROMPT =
  "Look at this image and extract every film or movie referenced in it. " +
  "Read all visible text — printed titles, captions overlaid on stills, " +
  "poster artwork, cinema listings, handwritten lists — and also identify " +
  "films you recognise from the imagery itself even where the title is not " +
  "written out. " +
  "This is very often one of: a grid or collage of film stills with the " +
  "title printed under or over each one; a screenshot of a social media " +
  "post listing films; or a photograph of a poster or cinema programme. " +
  "When it is a grid or list, read every single entry, in the order they " +
  "appear — do not stop after the first few. " +
  "Ignore text that is not part of the content itself: app chrome, usernames, " +
  "follower counts, button labels, timestamps, battery and signal indicators. " +
  "For each film return its canonical title, the four-digit release year " +
  "(empty string if unknown), and a confidence_score from 0.0 to 1.0 " +
  "reflecting how certain you are this is a real film reference rather than " +
  "a song, book, or unrelated phrase. Exclude TV series and short films. " +
  "If the image presents a themed or ranked collection (e.g. a decade, a " +
  "genre, a 'best of' countdown), set list_title to a short name suitable " +
  "for a playlist, e.g. 'Best Films of the 1930s'; otherwise set list_title " +
  "to null. " +
  "Format the result into the requested JSON schema.";

/**
 * Extract film references from a base64-encoded image.
 *
 * @param imageBase64 Raw base64 (no `data:` prefix).
 * @param mimeType    Must be a key of SUPPORTED_IMAGE_TYPES.
 */
export async function extractMoviesFromImage(
  imageBase64: string,
  mimeType: string
): Promise<GeminiExtractionResult> {
  const extension = SUPPORTED_IMAGE_TYPES[mimeType];
  if (!extension) {
    throw new Error(`Unsupported image type: ${mimeType}`);
  }

  const buffer = Buffer.from(imageBase64, "base64");
  if (buffer.length === 0) {
    throw new Error("Image data was empty or not valid base64");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image is ${Math.round(buffer.length / 1024 / 1024)}MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit`
    );
  }

  const imagePath = join(tmpdir(), `film-locker-image-${randomUUID()}.${extension}`);
  writeFileSync(imagePath, buffer);

  try {
    return await uploadAndAnalyzeMedia(
      getClient(),
      imagePath,
      mimeType,
      IMAGE_PROMPT,
      "user-supplied-image"
    );
  } finally {
    try { unlinkSync(imagePath); } catch { /* ignore */ }
  }
}
