/**
 * geminiModel.ts
 *
 * Single source of truth for which Gemini model the whole app calls.
 * Previously this string was duplicated across four files — when
 * gemini-2.5-flash's retirement date arrived, that would've meant hunting
 * down every copy under time pressure. Now it's one constant.
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
