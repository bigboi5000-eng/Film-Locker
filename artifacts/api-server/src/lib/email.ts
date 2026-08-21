import { logger } from "./logger";

const RECIPIENT = "jakepltanner@gmail.com";

/**
 * Sends one email via Resend's REST API (no SDK needed — it's one POST
 * request). Requires RESEND_API_KEY. Without a verified sending domain,
 * Resend only allows sending FROM its shared onboarding@resend.dev address
 * TO the email that owns the Resend account — which is exactly this
 * recipient, so no domain purchase/verification is needed to get this
 * working. Never throws — the caller has already saved whatever this
 * notifies about to the database, so an email failure here should never
 * fail the request.
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
        from: "Film Locker <onboarding@resend.dev>",
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
