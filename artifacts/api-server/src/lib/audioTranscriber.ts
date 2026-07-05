/**
 * audioTranscriber.ts
 *
 * Downloads the audio track of any yt-dlp-supported URL (Instagram, TikTok,
 * YouTube, etc.) and transcribes it with OpenAI Whisper.
 *
 * Flow:
 *   1. yt-dlp extracts the best audio stream → /tmp/film-locker-<uuid>.mp3
 *   2. The mp3 is streamed to OpenAI's Whisper API (whisper-1 model).
 *   3. The temp file is deleted whether or not transcription succeeds.
 *
 * Cost note: Whisper API is billed at ~$0.006 / minute of audio (uses your
 * existing OPENAI_API_KEY — no separate key required).
 *
 * yt-dlp must be installed. This module tries the following paths in order:
 *   $YT_DLP_PATH env var  →  ~/.local/bin/yt-dlp  →  yt-dlp (system PATH)
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";

const execFileAsync = promisify(execFile);
const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

/** Resolve the yt-dlp executable path. */
function ytDlpBin(): string {
  if (process.env["YT_DLP_PATH"]) return process.env["YT_DLP_PATH"];
  const home = process.env["HOME"] ?? "/root";
  const localBin = join(home, ".local", "bin", "yt-dlp");
  if (existsSync(localBin)) return localBin;
  return "yt-dlp"; // fall back to PATH
}

/**
 * Download the audio track of `videoUrl` to a temp mp3 file using yt-dlp.
 * Returns the path of the downloaded file.
 *
 * Throws if yt-dlp fails or produces no output file.
 */
async function downloadAudio(videoUrl: string): Promise<string> {
  const outPath = join(tmpdir(), `film-locker-audio-${randomUUID()}.mp3`);
  const bin = ytDlpBin();

  // Arguments are passed as an array — videoUrl is NEVER interpolated into a shell
  // string, which eliminates command-injection risk entirely.
  //
  // -x              extract audio only (no video download)
  // --audio-format  force conversion to mp3 (requires ffmpeg)
  // --audio-quality 5 is a mid-quality VBR setting (saves bandwidth; plenty for speech)
  // --no-playlist   never download a whole playlist
  // --quiet         suppress progress bars in server logs
  // -o              output template (yt-dlp appends .mp3 automatically)
  const args = [
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "5",
    "--no-playlist",
    "--quiet",
    "-o", outPath,
    videoUrl,          // raw argument — no shell, no injection surface
  ];

  try {
    await execFileAsync(bin, args, { timeout: 120_000 }); // 2-min hard limit
  } catch (err) {
    // yt-dlp may have created a partial file before failing — clean it up now
    // so repeated failures don't accumulate stale temp files.
    try { unlinkSync(outPath); } catch { /* file may not exist yet, ignore */ }
    throw new Error(`yt-dlp failed for ${videoUrl}: ${(err as Error).message}`);
  }

  if (!existsSync(outPath)) {
    throw new Error(
      `yt-dlp exited cleanly but produced no output file at ${outPath}`
    );
  }

  return outPath;
}

/**
 * Transcribe the audio at `videoUrl` using yt-dlp + OpenAI Whisper.
 *
 * Returns the transcribed text string.
 * Always cleans up the temp audio file, even on error.
 */
export async function transcribeAudio(videoUrl: string): Promise<string> {
  if (!process.env["OPENAI_API_KEY"]) {
    throw new Error(
      "OPENAI_API_KEY is not set. Audio transcription requires the OpenAI Whisper API."
    );
  }

  const audioPath = await downloadAudio(videoUrl);

  try {
    const transcript = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: createReadStream(audioPath),
      language: "en",
      response_format: "text",
    });

    // When response_format is "text", the SDK returns the raw string directly.
    const text =
      typeof transcript === "string" ? transcript : (transcript as { text: string }).text;

    if (!text || text.trim().length === 0) {
      throw new Error("Whisper returned an empty transcript");
    }

    return text.trim();
  } finally {
    // Always clean up — even if Whisper throws
    try {
      unlinkSync(audioPath);
    } catch {
      /* ignore cleanup errors */
    }
  }
}
