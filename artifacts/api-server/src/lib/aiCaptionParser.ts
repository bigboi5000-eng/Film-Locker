import OpenAI from "openai";
import { extractTitleCandidates } from "./captionParser";

let _client: OpenAI | null = null;

function getClient(): OpenAI | null {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return null;
  if (!_client) _client = new OpenAI({ apiKey });
  return _client;
}

/**
 * Uses GPT to extract movie titles from a social media caption.
 * Falls back to heuristic extraction if OpenAI is unavailable.
 */
export async function extractMovieTitlesAI(caption: string): Promise<string[]> {
  const client = getClient();

  if (!client) {
    return extractTitleCandidates(caption);
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 512,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You extract movie and TV film titles from social media captions. " +
            "Return ONLY a JSON array of title strings, e.g. [\"Inception\", \"The Godfather\"]. " +
            "Include every film or movie mentioned, even oblique references. " +
            "Do not include TV shows, books, or songs — only theatrical/streaming films. " +
            "Return [] if no films are mentioned. Never return anything except the JSON array.",
        },
        {
          role: "user",
          content: caption,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "[]";
    // Strip markdown code fences if GPT wraps the JSON
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return (parsed as string[]).filter((t) => t.trim().length > 0).slice(0, 15);
    }

    return extractTitleCandidates(caption);
  } catch (err) {
    // Log and fall back to heuristics on any OpenAI error
    return extractTitleCandidates(caption);
  }
}
