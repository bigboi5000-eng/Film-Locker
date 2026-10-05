/**
 * moderateText.ts
 *
 * Checks user-written text before it is stored.
 *
 * Required by App Store Review Guideline 1.2, which asks any app carrying
 * user-generated content for "a method for filtering objectionable content"
 * alongside the flagging, blocking and contact routes the app already has.
 * Reporting is after the fact; this is the part that stops it being posted.
 *
 * Two layers, cheapest first:
 *
 *   1. A word list, for the handful of slurs that need no judgement. Free,
 *      instant, and catches the obvious cases without a network call.
 *   2. Gemini, for everything a word list cannot do — harassment, threats,
 *      sexual content, coded abuse, and the endless misspellings that walk
 *      straight past a list.
 *
 * It fails closed. If the model cannot be reached, the comment is refused
 * rather than stored unchecked: an unavailable filter must not become an
 * absent one, which is exactly the hole the guideline is about. The caller
 * tells the user to try again, which is recoverable, where publishing abuse
 * is not.
 */
import { Type } from "@google/genai";
import { GoogleGenAI } from "@google/genai";
import { GEMINI_TEXT_MODEL } from "./geminiModel";
import { withGeminiRetry } from "./geminiRetry";
import { logger } from "./logger";

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  if (!_client) _client = new GoogleGenAI({ apiKey });
  return _client;
}

/**
 * Slurs and sexual terms that are objectionable in any context, so no model
 * call is needed. Deliberately short: anything whose offensiveness depends
 * on how it is used belongs to the model below, not here, or the filter
 * starts rejecting ordinary film discussion.
 *
 * Matched on word boundaries against the lower-cased text, with common
 * letter-for-symbol substitutions folded first.
 */
const HARD_BLOCKED = [
  "nigger", "nigga", "faggot", "fag", "retard", "retarded", "tranny",
  "kike", "spic", "chink", "paki", "wetback", "coon",
  "cunt", "rape", "raping", "rapist", "paedo", "pedo", "paedophile", "pedophile",
  "childporn", "cp",
];

/** Fold the substitutions people use to slip a word list. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0@]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5\$/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z\s]/g, "");
}

function hitsWordList(text: string): string | null {
  const normalised = normalise(text);
  for (const term of HARD_BLOCKED) {
    if (new RegExp(`\\b${term}\\b`).test(normalised)) return term;
  }
  return null;
}

export interface ModerationVerdict {
  allowed: boolean;
  /** Why it was refused, safe to show the user. Null when allowed. */
  reason: string | null;
}

const MODERATION_PROMPT =
  "You are moderating comments on a film discussion app. The comment is " +
  "about a film. Decide whether it must be blocked.\n\n" +
  "BLOCK the comment if it contains any of: hate speech or slurs targeting " +
  "a group; harassment, abuse or insults aimed at a person; threats or " +
  "incitement to violence; sexual content or sexual descriptions of people; " +
  "sexual content involving minors; content promoting self-harm; spam, " +
  "scams or advertising; or personal information about someone such as an " +
  "address or phone number.\n\n" +
  "ALLOW ordinary film discussion, including strong criticism of a film, " +
  "its director or its cast, swearing used as emphasis rather than at a " +
  "person, and discussion of violent, sexual or disturbing themes *in a " +
  "film* — describing what a horror film depicts is not itself " +
  "objectionable. Allow spoilers. Allow negative opinions.\n\n" +
  "When blocking, give a short reason the commenter can understand, no " +
  "more than one sentence, and never repeat the offending words back.";

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    blocked: {
      type: Type.BOOLEAN,
      description: "True if the comment must not be posted.",
    },
    reason: {
      type: Type.STRING,
      description:
        "One short sentence the commenter can understand. Empty string when not blocked.",
    },
  },
  required: ["blocked", "reason"],
};

/**
 * Decide whether `text` may be stored.
 *
 * Throws only when the check itself could not be completed — the caller
 * must treat that as a refusal, not as permission.
 */
export async function moderateText(text: string): Promise<ModerationVerdict> {
  const listHit = hitsWordList(text);
  if (listHit) {
    logger.warn({ term: listHit }, "moderation: blocked by word list");
    return { allowed: false, reason: "That comment contains language we don't allow." };
  }

  const response = await withGeminiRetry("moderation", () =>
    getClient().models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: [{ role: "user", parts: [{ text: `${MODERATION_PROMPT}\n\nComment:\n${text}` }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        // Deterministic: the same comment must not be allowed on a retry
        // that it was refused on a moment earlier.
        temperature: 0,
      },
    })
  );

  const raw = response.text;
  if (!raw) throw new Error("moderation: empty response from Gemini");

  const parsed = JSON.parse(raw) as { blocked?: boolean; reason?: string };
  if (typeof parsed.blocked !== "boolean") {
    throw new Error("moderation: response did not contain a verdict");
  }

  if (parsed.blocked) {
    logger.warn({ reason: parsed.reason }, "moderation: blocked by model");
    return {
      allowed: false,
      reason: parsed.reason?.trim() || "That comment breaks our community rules.",
    };
  }

  return { allowed: true, reason: null };
}
