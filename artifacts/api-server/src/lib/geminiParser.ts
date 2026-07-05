import { GoogleGenAI, Type } from "@google/genai";

export interface GeminiMovieMatch {
  movie_title: string;
  release_year: string;
  confidence_score: number;
}

interface GeminiResponse {
  movies: GeminiMovieMatch[];
}

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  if (!_client) _client = new GoogleGenAI({ apiKey });
  return _client;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    movies: {
      type: Type.ARRAY,
      description: "All movies or films referenced in the text",
      items: {
        type: Type.OBJECT,
        properties: {
          movie_title: {
            type: Type.STRING,
            description: "The exact canonical title of the movie",
          },
          release_year: {
            type: Type.STRING,
            description:
              "Four-digit release year, e.g. '2010'. Empty string if unknown.",
          },
          confidence_score: {
            type: Type.NUMBER,
            description:
              "Confidence 0.0–1.0 that this token is truly a movie reference. " +
              "1.0 = unmistakably a film title. 0.0 = almost certainly not.",
          },
        },
        required: ["movie_title", "release_year", "confidence_score"],
      },
    },
  },
  required: ["movies"],
};

const SYSTEM_PROMPT =
  "You are a film-identification expert. Given any text — social media captions, " +
  "reviews, lists, or freeform prose — extract every theatrical or streaming film " +
  "referenced. For each film return its canonical title, the four-digit release year " +
  "(leave empty if genuinely unknown), and a confidence_score from 0.0 to 1.0 " +
  "reflecting how certain you are this is a real movie reference and not a song, " +
  "book, or figure of speech. Exclude TV series and short films.";

/**
 * Uses Gemini 2.5 Flash with a structured JSON schema to extract movie
 * references (title, release_year, confidence_score) from arbitrary text.
 */
export async function extractMoviesWithGemini(
  text: string
): Promise<GeminiMovieMatch[]> {
  const ai = getClient();

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [{ text: `${SYSTEM_PROMPT}\n\nText to analyse:\n${text}` }],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0,
    },
  });

  // Safely parse the structured response
  const raw = response.text ?? "{}";
  let parsed: GeminiResponse;
  try {
    parsed = JSON.parse(raw) as GeminiResponse;
  } catch {
    throw new Error(
      `Gemini returned non-JSON output: ${raw.slice(0, 200)}`
    );
  }

  const movies = Array.isArray(parsed.movies) ? parsed.movies : [];

  return movies
    .filter(
      (m) =>
        m != null &&
        typeof m.movie_title === "string" &&
        m.movie_title.trim().length > 0
    )
    .map((m) => {
      const raw_score = Number(m.confidence_score);
      const confidence_score = Number.isFinite(raw_score)
        ? Math.min(1, Math.max(0, raw_score))
        : 0;
      return {
        movie_title: m.movie_title.trim(),
        release_year: (m.release_year ?? "").trim(),
        confidence_score,
      };
    });
}
