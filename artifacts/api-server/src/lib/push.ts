/**
 * push.ts
 *
 * One place to send an Expo push notification.
 *
 * Extracted from routes/notifications.ts, where the token check, the send and
 * the swallow-everything catch were written inline. A second caller (follow
 * requests) needed the same three steps, and copying them is how the two
 * drift — one gains a guard the other never gets.
 *
 * Every function here is best-effort and never throws. Callers have already
 * committed whatever the push is announcing; a notification that fails to
 * send must not fail the request that caused it. The in-app screens are the
 * reliable surface, push is the nudge on top.
 */
import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { logger } from "./logger";

const expo = new Expo();

/**
 * Send one push notification.
 *
 * `token` is whatever was stored against the user, which may be null (push
 * never granted), stale, or from a build that no longer exists — so it is
 * validated rather than trusted.
 *
 * `screen` is read by the tap handler in the app's root layout to deep-link
 * somewhere useful instead of just opening the app.
 */
export async function sendPush(opts: {
  token: string | null | undefined;
  title: string;
  body: string;
  screen?: string;
}): Promise<void> {
  const { token, title, body, screen } = opts;
  if (!token || !Expo.isExpoPushToken(token)) return;

  const message: ExpoPushMessage = {
    to: token,
    title,
    body,
    sound: "default",
    ...(screen ? { data: { screen } } : {}),
  };

  try {
    await expo.sendPushNotificationsAsync([message]);
  } catch (err) {
    // Non-fatal by design — see the file comment.
    logger.warn({ err, title }, "push notification failed to send");
  }
}
