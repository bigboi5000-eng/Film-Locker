/**
 * audioExtractor.ts
 *
 * Downloads the audio track of any yt-dlp-supported URL, then passes the
 * audio file directly to Gemini 2.5 Flash via the Files API for native
 * multimodal movie extraction — no text transcription step needed.
 *
 * Flow:
 *   1. yt-dlp  →  /tmp/film-locker-audio-<uuid>.mp3
 *   2. uploadAndAnalyzeMedia() (geminiMediaExtractor.ts) → GeminiExtractionResult
 *   3. Local temp file deleted in finally block
 *
 * Cheaper/faster than videoExtractor.ts but only sees narration, not
 * on-screen text — processSocialLink.ts tries this before falling back to
 * the full video.
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

const AUDIO_PROMPT =
  "Listen to this audio track from a social media clip. " +
  "Extract every movie title and release year being discussed or referenced. " +
  "For each film, return its canonical title, the four-digit release year " +
  "(empty string if unknown), and a confidence_score from 0.0 to 1.0 reflecting " +
  "how certain you are this is a real movie reference and not a song, book, or " +
  "figure of speech. Exclude TV series and short films. If this is a 'Top N' or " +
  "countdown-style list, extract every title mentioned, not just the first few, " +
  "and set list_title to a short name for the list (e.g. 'Top 10 Horror Films of " +
  "All Time'); otherwise set list_title to null. " +
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
 * Download the audio track of `videoUrl` to a temp mp3 file.
 * Cleans up any partial output file if yt-dlp fails.
 */
async function downloadAudio(videoUrl: string): Promise<string> {
  const outPath = join(tmpdir(), `film-locker-audio-${randomUUID()}.mp3`);
  const bin = ytDlpBin();

  // Args are passed as an array — videoUrl is never interpolated into a shell
  // string, which eliminates command-injection risk entirely.
  const args = [
    "-x",
    "--audio-format", "mp3",
    // Lower VBR quality (0=best, 9=worst) than before — Gemini only needs
    // to make out speech, not reproduce it faithfully, so a smaller/faster
    // encode costs nothing in extraction accuracy while cutting encode and
    // upload time for this step.
    "--audio-quality", "7",
    "--no-playlist",
    "--quiet",
    "-o", outPath,
    videoUrl,
  ];

  try {
    await execFileAsync(bin, args, { timeout: 120_000 });
  } catch (err) {
    // Clean up any partial file yt-dlp may have written before failing
    try { unlinkSync(outPath); } catch { /* may not exist, ignore */ }
    throw new Error(`yt-dlp failed for ${videoUrl}: ${(err as Error).message}`);
  }

  if (!existsSync(outPath)) {
    throw new Error(`yt-dlp exited cleanly but produced no output file at ${outPath}`);
  }

  return outPath;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Download the audio from `videoUrl` and use Gemini 2.5 Flash's native
 * multimodal understanding to extract movie references directly from the audio.
 *
 * Always cleans up both the local temp file and the Gemini-hosted file.
 */
export async function extractMoviesFromAudio(
  videoUrl: string
): Promise<GeminiExtractionResult> {
  const ai = getClient();
  const audioPath = await downloadAudio(videoUrl);

  try {
    return await uploadAndAnalyzeMedia(
      ai,
      audioPath,
      "audio/mpeg",
      AUDIO_PROMPT,
      "social-clip-audio"
    );
  } finally {
    try { unlinkSync(audioPath); } catch { /* ignore */ }
  }
}
