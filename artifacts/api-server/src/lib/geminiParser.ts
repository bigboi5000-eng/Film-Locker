import { GoogleGenAI, Type } from "@google/genai";

export interface GeminiMovieMatch {
  movie_title: string;
  release_year: string;
  confidence_score: number;
}

export interface GeminiExtractionResult {
  movies: GeminiMovieMatch[];
  /**
   * Suggested playlist name when the source text is a curated/ranked list
   * (e.g. "Top 10 Horror Films of All Time"), null for a single-film mention.
   */
  list_title: string | null;
}

interface GeminiResponse {
  movies: GeminiMovieMatch[];
  list_title?: string | null;
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
    list_title: {
      type: Type.STRING,
      nullable: true,
      description:
        "When the text is a curated/ranked list of multiple films (e.g. a " +
        "'Top 10 Horror Films' countdown, a 'Best of' roundup, a themed " +
        "watchlist), a short human-readable title suitable for naming a " +
        "playlist — e.g. 'Top 10 Horror Films of All Time'. Null when the " +
        "text is not a list (a single film mention, a review of one movie, " +
        "unrelated content).",
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
  "book, or figure of speech. Exclude TV series and short films.\n\n" +
  "If the text is a 'Top N', countdown, ranked, or curated list of films " +
  "(e.g. 'Top 10 Horror Films of All Time', 'My 5 favorite heist movies'), " +
  "you MUST extract every single title in the list, not just the first few — " +
  "count the items and keep going until you've covered all of them, even if " +
  "the list runs to 10, 20, or more entries. Also set list_title to a short, " +
  "human-readable name for the list (e.g. 'Top 10 Horror Films of All Time') " +
  "so it can be used as a playlist name. If the text is not a list — a single " +
  "film mention, a review of one movie, or unrelated content — set list_title " +
  "to null.";

/**
 * Uses Gemini 2.5 Flash with a structured JSON schema to extract movie
 * references (title, release_year, confidence_score) from arbitrary text,
 * plus a list_title when the text is a curated/ranked list of films.
 */
export async function extractMoviesWithGemini(
  text: string
): Promise<GeminiExtractionResult> {
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

  const mapped = movies
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

  // Only treat list_title as meaningful when Gemini actually found more than
  // one film — a single-match "list" is just a regular mention.
  const list_title =
    mapped.length > 1 && typeof parsed.list_title === "string" && parsed.list_title.trim().length > 0
      ? parsed.list_title.trim()
      : null;

  return { movies: mapped, list_title };
}
