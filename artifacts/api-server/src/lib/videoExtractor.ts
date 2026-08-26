/**
 * videoExtractor.ts
 *
 * Downloads the actual video (not just its audio track) and passes it to
 * Gemini 2.5 Flash natively, so it can read on-screen text — captions,
 * countdown graphics, title cards — in addition to narration.
 *
 * This exists because audioExtractor.ts only "hears" a clip: a silent
 * "Top 10 Horror Films" countdown that shows each title as on-screen text
 * with no voiceover produces nothing from audio-only transcription. Video
 * understanding catches that, at the cost of a slower download and a larger
 * upload, so processSocialLink.ts only reaches for this after both the
 * caption/URL-grounding step AND the audio step have failed.
 *
 * Flow:
 *   1. yt-dlp  →  /tmp/film-locker-video-<uuid>.mp4 (capped resolution/size/duration)
 *   2. uploadAndAnalyzeMedia() (geminiMediaExtractor.ts) → GeminiExtractionResult
 *   3. Local temp file deleted in finally block
 *
 * Only credential required: GEMINI_API_KEY.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import type { GeminiExtractionResult } from "./geminiParser";
import { uploadAndAnalyzeMedia } from "./geminiMediaExtractor";

const execFileAsync = promisify(execFile);

// ── Gemini client ─────────────────────────────────────────────────────────────

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  if (!_client) _client = new GoogleGenAI({ apiKey });
  return _client;
}

const VIDEO_PROMPT =
  "Watch this video clip from a social media post, including any on-screen text, " +
  "title cards, captions, or graphics — not just narration or dialogue. " +
  "Extract every movie title and release year being shown or discussed. " +
  "For each film, return its canonical title, the four-digit release year " +
  "(empty string if unknown), and a confidence_score from 0.0 to 1.0 reflecting " +
  "how certain you are this is a real movie reference and not a song, book, or " +
  "figure of speech. Exclude TV series and short films. This is very often a " +
  "'Top N' or countdown-style list revealed through on-screen text with quiet or " +
  "no narration — read every title shown, in order, even if there is no voiceover " +
  "mentioning it, and set list_title to a short name for the list (e.g. 'Top 10 " +
  "Horror Films of All Time'); otherwise set list_title to null. " +
  "Format the result into the requested JSON schema.";

// ── yt-dlp helper ─────────────────────────────────────────────────────────────

function ytDlpBin(): string {
  if (process.env["YT_DLP_PATH"]) return process.env["YT_DLP_PATH"];
  const home = process.env["HOME"] ?? "/root";
  const localBin = join(home, ".local", "bin", "yt-dlp");
  if (existsSync(localBin)) return localBin;
  return "yt-dlp";
}

/**
 * Download `videoUrl` to a temp mp4 file, capped to keep the Gemini upload
 * and processing time reasonable for a short-form social clip.
 * Cleans up any partial output file if yt-dlp fails.
 */
async function downloadVideo(videoUrl: string): Promise<string> {
  const outPath = join(tmpdir(), `film-locker-video-${randomUUID()}.mp4`);
  const bin = ytDlpBin();

  // Args are passed as an array — videoUrl is never interpolated into a shell
  // string, which eliminates command-injection risk entirely.
  const args = [
    // Prefer a modest resolution — we only need on-screen text to be legible,
    // not full quality, and a smaller file downloads, uploads, and gets
    // processed by Gemini faster. 360p still reads large title-card/countdown
    // text fine, which is all this last-resort fallback exists for.
    "-f", "best[height<=360][ext=mp4]/best[height<=360]/best",
    "--recode-video", "mp4",
    // Skip anything longer than 10 minutes — short-form list content this
    // fallback targets is almost always well under that.
    "--match-filter", "duration<600",
    "--max-filesize", "30M",
    "--no-playlist",
    "--quiet",
    "-o", outPath,
    videoUrl,
  ];

  try {
    await execFileAsync(bin, args, { timeout: 180_000 });
  } catch (err) {
    // Clean up any partial file yt-dlp may have written before failing
    try { unlinkSync(outPath); } catch { /* may not exist, ignore */ }
    throw new Error(`yt-dlp (video) failed for ${videoUrl}: ${(err as Error).message}`);
  }

  if (!existsSync(outPath)) {
    throw new Error(`yt-dlp exited cleanly but produced no video file at ${outPath}`);
  }

  return outPath;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Download the video from `videoUrl` and use Gemini 2.5 Flash's native
 * multimodal understanding — including on-screen text — to extract movie
 * references from it.
 *
 * Always cleans up both the local temp file and the Gemini-hosted file.
 */
export async function extractMoviesFromVideo(
  videoUrl: string
): Promise<GeminiExtractionResult> {
  const ai = getClient();
  const videoPath = await downloadVideo(videoUrl);

  try {
    return await uploadAndAnalyzeMedia(
      ai,
      videoPath,
      "video/mp4",
      VIDEO_PROMPT,
      "social-clip-video"
    );
  } finally {
    try { unlinkSync(videoPath); } catch { /* ignore */ }
  }
}
