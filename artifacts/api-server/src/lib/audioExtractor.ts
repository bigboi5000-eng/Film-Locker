/**
 * audioExtractor.ts
 *
 * Downloads the audio track of any yt-dlp-supported URL, then passes the
 * audio file directly to Gemini 2.5 Flash via the Files API for native
 * multimodal movie extraction — no text transcription step needed.
 *
 * Flow:
 *   1. yt-dlp  →  /tmp/film-locker-<uuid>.mp3
 *   2. ai.files.upload()  →  Gemini-hosted file URI
 *   3. gemini-2.5-flash (audio + structured schema)  →  GeminiMovieMatch[]
 *   4. Temp file + uploaded file deleted in finally blocks
 *
 * Only credential required: GEMINI_API_KEY.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { GoogleGenAI, Type } from "@google/genai";
import type { GeminiMovieMatch } from "./geminiParser";

const execFileAsync = promisify(execFile);

// ── Gemini client ─────────────────────────────────────────────────────────────

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  if (!_client) _client = new GoogleGenAI({ apiKey });
  return _client;
}

// ── Structured schema (mirrors geminiParser.ts) ───────────────────────────────

const AUDIO_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    movies: {
      type: Type.ARRAY,
      description: "All movies or films referenced in the audio",
      items: {
        type: Type.OBJECT,
        properties: {
          movie_title: {
            type: Type.STRING,
            description: "The exact canonical title of the movie",
          },
          release_year: {
            type: Type.STRING,
            description: "Four-digit release year, e.g. '2010'. Empty string if unknown.",
          },
          confidence_score: {
            type: Type.NUMBER,
            description:
              "Confidence 0.0–1.0 that this is a genuine movie reference. " +
              "1.0 = unmistakably a film title. 0.0 = almost certainly not.",
          },
        },
        required: ["movie_title", "release_year", "confidence_score"],
      },
    },
  },
  required: ["movies"],
};

const AUDIO_PROMPT =
  "Listen to this audio track from a social media clip. " +
  "Extract every movie title and release year being discussed or referenced. " +
  "For each film, return its canonical title, the four-digit release year " +
  "(empty string if unknown), and a confidence_score from 0.0 to 1.0 reflecting " +
  "how certain you are this is a real movie reference and not a song, book, or " +
  "figure of speech. Exclude TV series and short films. " +
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
    "--audio-quality", "5",
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
 * Returns an array of GeminiMovieMatch — the same shape as extractMoviesWithGemini()
 * so the caller can pipe results straight into enrichAndSaveMatches().
 *
 * Always cleans up both the local temp file and the Gemini-hosted file.
 */
export async function extractMoviesFromAudio(
  videoUrl: string
): Promise<GeminiMovieMatch[]> {
  const ai = getClient();

  // 1. Download audio locally
  const audioPath = await downloadAudio(videoUrl);

  let uploadedFileName: string | undefined;

  try {
    // 2. Upload to Gemini Files API
    const uploadedFile = await ai.files.upload({
      file: audioPath,
      config: { mimeType: "audio/mpeg", displayName: "social-clip-audio" },
    });

    uploadedFileName = uploadedFile.name;

    if (!uploadedFile.uri) {
      throw new Error("Gemini Files API returned no URI for the uploaded audio");
    }

    // 3. Poll until the file is ACTIVE (Gemini processes uploads asynchronously)
    //    State transitions: PROCESSING → ACTIVE | FAILED
    //    Without this, generateContent may receive a file that isn't ready yet.
    {
      const MAX_WAIT_MS = 60_000;
      const POLL_INTERVAL_MS = 2_000;
      const deadline = Date.now() + MAX_WAIT_MS;

      let fileState = uploadedFile.state ?? "PROCESSING";

      while (fileState === "PROCESSING" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const refreshed = await ai.files.get({ name: uploadedFileName! });
        fileState = (refreshed.state as string) ?? "PROCESSING";
      }

      if (fileState === "FAILED") {
        throw new Error("Gemini Files API: file processing failed after upload");
      }
      if (fileState === "PROCESSING") {
        throw new Error(
          `Gemini Files API: file still in PROCESSING state after ${MAX_WAIT_MS / 1000}s`
        );
      }
      // fileState === "ACTIVE" — safe to proceed
    }

    // 4. Call Gemini with audio + structured schema
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              fileData: {
                mimeType: "audio/mpeg",
                fileUri: uploadedFile.uri,
              },
            },
            { text: AUDIO_PROMPT },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: AUDIO_RESPONSE_SCHEMA,
        temperature: 0,
      },
    });

    // 4. Parse structured response
    const raw = response.text ?? "{}";
    let parsed: { movies?: GeminiMovieMatch[] };
    try {
      parsed = JSON.parse(raw) as { movies?: GeminiMovieMatch[] };
    } catch {
      throw new Error(`Gemini returned non-JSON audio response: ${raw.slice(0, 200)}`);
    }

    const movies = Array.isArray(parsed.movies) ? parsed.movies : [];

    return movies
      .filter(
        (m) =>
          m != null &&
          typeof m.movie_title === "string" &&
          m.movie_title.trim().length > 0
      )
      .map((m) => ({
        movie_title: m.movie_title.trim(),
        release_year: (m.release_year ?? "").trim(),
        confidence_score: (() => {
          const s = Number(m.confidence_score);
          return Number.isFinite(s) ? Math.min(1, Math.max(0, s)) : 0;
        })(),
      }));
  } finally {
    // Always clean up the local temp file
    try { unlinkSync(audioPath); } catch { /* ignore */ }

    // Always delete the file from Gemini's storage
    if (uploadedFileName) {
      try { await ai.files.delete({ name: uploadedFileName }); } catch { /* ignore */ }
    }
  }
}
