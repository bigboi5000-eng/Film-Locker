/**
 * geminiModel.ts
 *
 * Single source of truth for which Gemini models the app calls.
 *
 * gemini-2.5-flash retires 2026-10-16 (Google's own forums report some
 * projects seeing "model no longer available" even before that date, so
 * don't wait for the deadline to migrate again). Currently on
 * gemini-3.6-flash — stable/GA as of 2026-08, priced at $0.75/$3.75 per
 * million input/output tokens through end of 2026 (rising to $1.50/$7.50
 * from 2027-01-01). When it's time to move again, change this one line —
 * check https://ai.google.dev/gemini-api/docs/changelog for the current
 * GA Flash model first rather than assuming a name.
 */
export const GEMINI_MODEL = "gemini-3.6-flash";

/**
 * The model used for plain-text extraction only — reading film titles out of
 * a caption or a search query (geminiParser.ts).
 *
 * Split from GEMINI_MODEL because that constant also drives audio and video
 * understanding, search grounding, and recommendations. Those are not text
 * tasks: the video path reads titles off on-screen graphics, and the
 * recommender leans on the model actually knowing films. A Lite tier suits
 * pulling titles out of a sentence and would degrade all three.
 *
 * Set GEMINI_TEXT_MODEL in the environment to try a Lite model. It is read
 * from the environment rather than hardcoded on purpose:
 *
 *   - Model IDs are easy to get wrong, and a wrong one here 404s every
 *     caption call, which is the pipeline's main path. An env var can be
 *     corrected or removed in Railway in seconds, with no deploy.
 *   - It makes the two models comparable on the same build, so the accuracy
 *     cost of the cheaper tier can actually be measured rather than assumed.
 *
 * Unset, this falls back to GEMINI_MODEL, so the default behaviour is
 * exactly what it was before the split.
 *
 * Worth knowing before reaching for it: a caption call is roughly 900 tokens
 * in and 200 out, about $0.0014 on Flash. Lite saves on the order of a tenth
 * of a penny per call, so this is a latency lever far more than a cost one —
 * the spend is in the audio and video paths, where a single 60-second video
 * costs about ten captions.
 */
export const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || GEMINI_MODEL;
