/**
 * geminiRetry.ts
 *
 * Retries a Gemini call when the failure is Google's, not ours.
 *
 * This exists because of a specific, observed loss. A shared Instagram post
 * scraped a caption naming the film outright — director, writer, protagonist,
 * everything needed — and then the single Gemini call that reads captions
 * came back 503 "This model is currently experiencing high demand". One
 * transient refusal, and a request that had already succeeded fell through
 * to an audio download and a video download that both had nothing to fetch,
 * ending as "couldn't identify this film". The answer was in hand the whole
 * time.
 *
 * Only genuinely transient statuses are retried: 429 (rate limited), 500,
 * 502, 503, 504. A 400 is a malformed request and a 403 is a bad key —
 * repeating either just wastes the user's time, so they fail immediately.
 *
 * Delays are short on purpose. Someone is watching a spinner, and this sits
 * inside a pipeline that may still have downloads ahead of it, so the budget
 * here is a couple of seconds rather than the tens of seconds a background
 * job could afford.
 */

import { logger } from "./logger";

/** HTTP statuses worth trying again. Everything else is our fault, not load. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 400;

function statusOf(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number") return status;

  // Some failures only carry the status inside the serialised body, e.g.
  // `{"error":{"code":503,...}}` on the message.
  const message = (err as { message?: unknown }).message;
  if (typeof message === "string") {
    const match = message.match(/"code"\s*:\s*(\d{3})/);
    if (match) return Number(match[1]);
  }
  return null;
}

export function isRetryableGeminiError(err: unknown): boolean {
  const status = statusOf(err);
  return status !== null && RETRYABLE_STATUS.has(status);
}

/**
 * Runs `fn`, retrying it while it fails with a transient Gemini status.
 * `label` only identifies the call in the logs.
 */
export async function withGeminiRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryableGeminiError(err) || attempt === MAX_ATTEMPTS) throw err;

      // Exponential, with jitter so concurrent requests that hit the same
      // spike don't all come back at the same instant and recreate it.
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200;
      logger.warn(
        { label, attempt, status: statusOf(err), delayMs: Math.round(delay) },
        "Gemini call failed with a transient error — retrying",
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}
