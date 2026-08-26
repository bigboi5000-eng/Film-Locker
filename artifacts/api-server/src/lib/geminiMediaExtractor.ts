/**
 * geminiMediaExtractor.ts
 *
 * Shared Gemini Files API upload/poll/analyse/cleanup logic used by both
 * audioExtractor.ts (audio-only, cheaper/faster) and videoExtractor.ts
 * (full video, catches on-screen text that audio-only misses).
 *
 * Callers are responsible for producing the local file (via yt-dlp) and
 * deleting it — this module only manages the Gemini-hosted file lifecycle.
 */

import type { GoogleGenAI } from "@google/genai";
import { Type } from "@google/genai";
import type { GeminiExtractionResult, GeminiMovieMatch } from "./geminiParser";
import { GEMINI_MODEL } from "./geminiModel";

export const MEDIA_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    movies: {
      type: Type.ARRAY,
      description: "All movies or films referenced in the media",
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
    list_title: {
      type: Type.STRING,
      nullable: true,
      description:
        "When the media is presenting a curated/ranked list of multiple films " +
        "(e.g. a 'Top 10 Horror Films' countdown), a short human-readable title " +
        "suitable for naming a playlist. Null when it's not a list.",
    },
  },
  required: ["movies"],
};

/**
 * Upload a local media file to Gemini's Files API, wait for it to become
 * ACTIVE, run structured extraction against it, then delete the Gemini-hosted
 * copy. Does NOT touch the local file — the caller owns that.
 */
export async function uploadAndAnalyzeMedia(
  ai: GoogleGenAI,
  filePath: string,
  mimeType: string,
  prompt: string,
  displayName: string
): Promise<GeminiExtractionResult> {
  let uploadedFileName: string | undefined;

  try {
    const uploadedFile = await ai.files.upload({
      file: filePath,
      config: { mimeType, displayName },
    });

    uploadedFileName = uploadedFile.name;

    if (!uploadedFile.uri) {
      throw new Error("Gemini Files API returned no URI for the uploaded file");
    }

    // Poll until the file is ACTIVE (Gemini processes uploads asynchronously).
    // State transitions: PROCESSING → ACTIVE | FAILED
    {
      const MAX_WAIT_MS = 90_000;
      // Short social clips (the only thing this ever processes) typically
      // reach ACTIVE well under 2s — poll faster to catch that sooner
      // instead of averaging an extra ~1s of dead wait per request.
      const POLL_INTERVAL_MS = 1_000;
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

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { fileData: { mimeType, fileUri: uploadedFile.uri } },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: MEDIA_RESPONSE_SCHEMA,
        temperature: 0,
      },
    });

    const raw = response.text ?? "{}";
    let parsed: { movies?: GeminiMovieMatch[]; list_title?: string | null };
    try {
      parsed = JSON.parse(raw) as { movies?: GeminiMovieMatch[]; list_title?: string | null };
    } catch {
      throw new Error(`Gemini returned non-JSON media response: ${raw.slice(0, 200)}`);
    }

    const movies = Array.isArray(parsed.movies) ? parsed.movies : [];

    const mapped = movies
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

    const list_title =
      mapped.length > 1 && typeof parsed.list_title === "string" && parsed.list_title.trim().length > 0
        ? parsed.list_title.trim()
        : null;

    return { movies: mapped, list_title };
  } finally {
    if (uploadedFileName) {
      try {
        await ai.files.delete({ name: uploadedFileName });
      } catch {
        // ignore — Gemini garbage-collects orphaned files after 48h anyway
      }
    }
  }
}
