import { logger } from "./logger";

const FEEDBACK_RECIPIENT = "jakepltanner@gmail.com";

/**
 * Best-effort email notification via Resend's REST API (no SDK needed — it's
 * one POST request). Requires RESEND_API_KEY. Without a verified sending
 * domain, Resend only allows sending FROM its shared onboarding@resend.dev
 * address TO the email that owns the Resend account — which is exactly this
 * recipient, so no domain purchase/verification is needed to get this
 * working. Never throws — feedback is already saved to the database before
 * this runs, so an email failure here should never fail the request.
 */
export async function sendFeedbackEmail(opts: {
  fromUserEmail: string;
  message: string;
}): Promise<void> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    logger.warn("RESEND_API_KEY not set — feedback saved but no email sent");
    return;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Film Locker <onboarding@resend.dev>",
        to: [FEEDBACK_RECIPIENT],
        reply_to: opts.fromUserEmail,
        subject: `Film Locker feedback from ${opts.fromUserEmail}`,
        text: opts.message,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error({ status: res.status, body }, "Resend feedback email failed");
    }
  } catch (err) {
    logger.error({ err }, "Resend feedback email request failed");
  }
}
