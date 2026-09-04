import { logger } from "./logger";

/**
 * Where feedback and report notifications go, and who they come from.
 *
 * Both are environment-overridable because they have to change together.
 * Resend will only send FROM its shared onboarding@resend.dev address TO the
 * address that owns the Resend account — so with no verified sending domain,
 * the defaults below are the only pair that actually delivers. Pointing the
 * recipient at a domain address before verifying that domain in Resend gets
 * the mail rejected, and since sendEmail deliberately never throws, it fails
 * silently: feedback keeps saving to the database and simply never reaches
 * anyone.
 *
 * Once film-locker.com is verified in Resend, set both in Railway:
 *   FEEDBACK_EMAIL_TO=hello@film-locker.com
 *   FEEDBACK_EMAIL_FROM=Film Locker <noreply@film-locker.com>
 */
const RECIPIENT = process.env["FEEDBACK_EMAIL_TO"] ?? "jakepltanner@gmail.com";
const SENDER = process.env["FEEDBACK_EMAIL_FROM"] ?? "Film Locker <onboarding@resend.dev>";

/**
 * Sends one email via Resend's REST API (no SDK needed — it's one POST
 * request). Requires RESEND_API_KEY. Never throws — the caller has already
 * saved whatever this notifies about to the database, so an email failure
 * here should never fail the request.
 */
async function sendEmail(opts: { subject: string; text: string; replyTo?: string }): Promise<void> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    logger.warn({ subject: opts.subject }, "RESEND_API_KEY not set — saved but no email sent");
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
        from: SENDER,
        to: [RECIPIENT],
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
        subject: opts.subject,
        text: opts.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error({ status: res.status, body }, "Resend email failed");
    }
  } catch (err) {
    logger.error({ err }, "Resend email request failed");
  }
}

export function sendFeedbackEmail(opts: { fromUserEmail: string; message: string }): Promise<void> {
  return sendEmail({
    subject: `Film Locker feedback from ${opts.fromUserEmail}`,
    text: opts.message,
    replyTo: opts.fromUserEmail,
  });
}

export function sendReportEmail(opts: {
  reporterEmail: string;
  reportedUserEmail: string;
  reason: string;
  commentSnapshot?: string | null;
}): Promise<void> {
  const lines = [
    `Reported user: ${opts.reportedUserEmail}`,
    `Reported by: ${opts.reporterEmail}`,
    `Reason: ${opts.reason}`,
    ...(opts.commentSnapshot ? [`Reported comment: "${opts.commentSnapshot}"`] : []),
  ];
  return sendEmail({
    subject: `Film Locker report: ${opts.reportedUserEmail}`,
    text: lines.join("\n"),
    replyTo: opts.reporterEmail,
  });
}
