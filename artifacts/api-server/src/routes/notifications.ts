import { Router, type IRouter } from "express";
import { and, eq, or, desc } from "drizzle-orm";
import { db, filmNotificationsTable, conversationMessagesTable, usersTable, followsTable } from "@workspace/db";
import {
  SendNotificationBody,
  GetNotificationsResponse,
  SendNotificationResponse,
  MarkNotificationReadParams,
  MarkNotificationReadResponse,
  GetNotificationUsersResponse,
  SendConversationMessageBody,
} from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { isBlockedEitherWay } from "../lib/blocks";
import { Expo } from "expo-server-sdk";

const expo = new Expo();

const router: IRouter = Router();

// ── GET /notifications/users ─────────────────────────────────────────────────
// Returns only users the caller follows. Must be registered before
// /notifications/:id/read to avoid route collision.

router.get("/notifications/users", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  // Join follows → users to return only people this caller actively follows
  // (an accepted relationship — a still-pending request to a private user
  // doesn't grant permission to recommend films to them yet).
  const users = await db
    .select({
      clerkId: usersTable.clerkId,
      username: usersTable.username,
      displayInitials: usersTable.displayInitials,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(followsTable)
    .innerJoin(usersTable, eq(followsTable.followeeId, usersTable.clerkId))
    .where(and(eq(followsTable.followerId, clerkUserId), eq(followsTable.status, "accepted")))
    .orderBy(usersTable.username);

  res.json(GetNotificationUsersResponse.parse({ users }));
});

// ── GET /notifications ────────────────────────────────────────────────────────

router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  const rows = await db
    .select({
      id: filmNotificationsTable.id,
      fromUserId: filmNotificationsTable.fromUserId,
      toUserId: filmNotificationsTable.toUserId,
      tmdbId: filmNotificationsTable.tmdbId,
      filmTitle: filmNotificationsTable.filmTitle,
      posterUrl: filmNotificationsTable.posterUrl,
      isRead: filmNotificationsTable.isRead,
      createdAt: filmNotificationsTable.createdAt,
      fromUsername: usersTable.username,
      fromDisplayInitials: usersTable.displayInitials,
      fromAvatarUrl: usersTable.avatarUrl,
    })
    .from(filmNotificationsTable)
    .leftJoin(usersTable, eq(filmNotificationsTable.fromUserId, usersTable.clerkId))
    .where(eq(filmNotificationsTable.toUserId, clerkUserId))
    .orderBy(desc(filmNotificationsTable.createdAt));

  const unreadCount = rows.filter((r) => !r.isRead).length;

  const notifications = rows.map((r) => ({
    id: r.id,
    fromUserId: r.fromUserId,
    fromUsername: r.fromUsername ?? null,
    fromDisplayInitials: r.fromDisplayInitials ?? null,
    fromAvatarUrl: r.fromAvatarUrl ?? null,
    toUserId: r.toUserId,
    tmdbId: r.tmdbId,
    filmTitle: r.filmTitle,
    posterUrl: r.posterUrl,
    isRead: r.isRead,
    createdAt: r.createdAt,
  }));

  res.json(GetNotificationsResponse.parse({ notifications, unreadCount }));
});

// ── POST /notifications ───────────────────────────────────────────────────────

router.post("/notifications", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  const body = SendNotificationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { toUserId, tmdbId, filmTitle, posterUrl } = body.data;

  // Cannot recommend to yourself
  if (toUserId === clerkUserId) {
    res.status(400).json({ error: "Cannot send a recommendation to yourself." });
    return;
  }

  // Blocking already removes any follow between the two (see POST /blocks),
  // so this is belt-and-suspenders on top of the follow check below — kept
  // explicit so this endpoint doesn't silently depend on that side effect.
  if (await isBlockedEitherWay(clerkUserId, toUserId)) {
    res.status(403).json({ error: "You can't send a recommendation to this user." });
    return;
  }

  // Enforce follow relationship — caller must have an accepted follow on the
  // recipient (a still-pending request to a private user isn't enough yet)
  const [followRow] = await db
    .select({ id: followsTable.id })
    .from(followsTable)
    .where(
      and(
        eq(followsTable.followerId, clerkUserId),
        eq(followsTable.followeeId, toUserId),
        eq(followsTable.status, "accepted")
      )
    );

  if (!followRow) {
    res.status(403).json({ error: "You can only recommend films to people you follow." });
    return;
  }

  // Verify the recipient exists
  const [recipient] = await db
    .select({ clerkId: usersTable.clerkId })
    .from(usersTable)
    .where(eq(usersTable.clerkId, toUserId));

  if (!recipient) {
    res.status(404).json({ error: "Recipient user not found." });
    return;
  }

  const [inserted] = await db
    .insert(filmNotificationsTable)
    .values({ fromUserId: clerkUserId, toUserId, tmdbId, filmTitle, posterUrl })
    .returning();

  // Look up sender info and recipient's push token in parallel
  const [[sender], [recipientWithToken]] = await Promise.all([
    db
      .select({ username: usersTable.username, displayInitials: usersTable.displayInitials, avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkUserId)),
    db
      .select({ expoPushToken: usersTable.expoPushToken })
      .from(usersTable)
      .where(eq(usersTable.clerkId, toUserId)),
  ]);

  // Fire push notification — best-effort, never block the response
  const pushToken = recipientWithToken?.expoPushToken;
  if (pushToken && Expo.isExpoPushToken(pushToken)) {
    try {
      await expo.sendPushNotificationsAsync([
        {
          to: pushToken,
          title: "🎬 New film recommendation",
          body: `${sender?.username ?? "Someone"} recommended "${filmTitle}" to you`,
          data: { screen: "/(tabs)/notifications" },
          sound: "default",
        },
      ]);
    } catch {
      // Push failure is non-fatal — in-app inbox always works as fallback
    }
  }

  res.status(201).json(
    SendNotificationResponse.parse({
      id: inserted.id,
      fromUserId: inserted.fromUserId,
      fromUsername: sender?.username ?? null,
      fromDisplayInitials: sender?.displayInitials ?? null,
      fromAvatarUrl: sender?.avatarUrl ?? null,
      toUserId: inserted.toUserId,
      tmdbId: inserted.tmdbId,
      filmTitle: inserted.filmTitle,
      posterUrl: inserted.posterUrl,
      isRead: inserted.isRead,
      createdAt: inserted.createdAt,
    })
  );
});

// ── PATCH /notifications/:id/read ─────────────────────────────────────────────

router.patch("/notifications/:id/read", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  const params = MarkNotificationReadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { id } = params.data;

  const [updated] = await db
    .update(filmNotificationsTable)
    .set({ isRead: true })
    .where(
      and(
        eq(filmNotificationsTable.id, id),
        eq(filmNotificationsTable.toUserId, clerkUserId)
      )
    )
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Notification not found." });
    return;
  }

  // Fetch sender info for the response
  const [sender] = await db
    .select({ username: usersTable.username, displayInitials: usersTable.displayInitials, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.clerkId, updated.fromUserId));

  res.json(
    MarkNotificationReadResponse.parse({
      id: updated.id,
      fromUserId: updated.fromUserId,
      fromUsername: sender?.username ?? null,
      fromDisplayInitials: sender?.displayInitials ?? null,
      fromAvatarUrl: sender?.avatarUrl ?? null,
      toUserId: updated.toUserId,
      tmdbId: updated.tmdbId,
      filmTitle: updated.filmTitle,
      posterUrl: updated.posterUrl,
      isRead: updated.isRead,
      createdAt: updated.createdAt,
    })
  );
});

// ── Shared helper — is there any relationship (either direction follow, or an
// existing recommendation between the two) that permits messaging? ──────────

async function canMessage(userA: string, userB: string): Promise<boolean> {
  if (await isBlockedEitherWay(userA, userB)) return false;

  const [followRow] = await db
    .select({ id: followsTable.id })
    .from(followsTable)
    .where(
      and(
        eq(followsTable.status, "accepted"),
        or(
          and(eq(followsTable.followerId, userA), eq(followsTable.followeeId, userB)),
          and(eq(followsTable.followerId, userB), eq(followsTable.followeeId, userA))
        )
      )
    );
  return Boolean(followRow);
}

// ── GET /notifications/thread/:userId ─────────────────────────────────────────
// Merged, chronological chat feed with a specific user — recommendations sent
// either way, plus reactions/messages either way.

router.get("/notifications/thread/:userId", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const otherUserId = String(req.params.userId ?? "").trim();
  if (!otherUserId) { res.status(400).json({ error: "userId is required" }); return; }

  const betweenUs = or(
    and(eq(filmNotificationsTable.fromUserId, otherUserId), eq(filmNotificationsTable.toUserId, clerkUserId)),
    and(eq(filmNotificationsTable.fromUserId, clerkUserId), eq(filmNotificationsTable.toUserId, otherUserId))
  );
  const messagesBetweenUs = or(
    and(eq(conversationMessagesTable.fromUserId, otherUserId), eq(conversationMessagesTable.toUserId, clerkUserId)),
    and(eq(conversationMessagesTable.fromUserId, clerkUserId), eq(conversationMessagesTable.toUserId, otherUserId))
  );

  const [recRows, msgRows, [sender]] = await Promise.all([
    db
      .select({
        id: filmNotificationsTable.id,
        fromUserId: filmNotificationsTable.fromUserId,
        toUserId: filmNotificationsTable.toUserId,
        tmdbId: filmNotificationsTable.tmdbId,
        filmTitle: filmNotificationsTable.filmTitle,
        posterUrl: filmNotificationsTable.posterUrl,
        isRead: filmNotificationsTable.isRead,
        createdAt: filmNotificationsTable.createdAt,
      })
      .from(filmNotificationsTable)
      .where(betweenUs)
      .orderBy(desc(filmNotificationsTable.createdAt)),

    db
      .select({
        id: conversationMessagesTable.id,
        fromUserId: conversationMessagesTable.fromUserId,
        toUserId: conversationMessagesTable.toUserId,
        content: conversationMessagesTable.content,
        replyToNotificationId: conversationMessagesTable.replyToNotificationId,
        createdAt: conversationMessagesTable.createdAt,
        replyToFilmTitle: filmNotificationsTable.filmTitle,
      })
      .from(conversationMessagesTable)
      .leftJoin(filmNotificationsTable, eq(conversationMessagesTable.replyToNotificationId, filmNotificationsTable.id))
      .where(messagesBetweenUs)
      .orderBy(desc(conversationMessagesTable.createdAt)),

    db
      .select({ clerkId: usersTable.clerkId, username: usersTable.username, displayInitials: usersTable.displayInitials, avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.clerkId, otherUserId)),
  ]);

  const feed = [
    ...recRows.map((r) => ({
      type: "recommendation" as const,
      id: r.id,
      fromUserId: r.fromUserId,
      toUserId: r.toUserId,
      createdAt: r.createdAt,
      tmdbId: r.tmdbId,
      filmTitle: r.filmTitle,
      posterUrl: r.posterUrl,
      isRead: r.isRead,
      content: null,
      replyToNotificationId: null,
      replyToFilmTitle: null,
    })),
    ...msgRows.map((m) => ({
      type: "message" as const,
      id: m.id,
      fromUserId: m.fromUserId,
      toUserId: m.toUserId,
      createdAt: m.createdAt,
      tmdbId: null,
      filmTitle: null,
      posterUrl: null,
      isRead: null,
      content: m.content,
      replyToNotificationId: m.replyToNotificationId,
      replyToFilmTitle: m.replyToFilmTitle ?? null,
    })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // Mark recommendations this user sent me as read, in the background
  void db
    .update(filmNotificationsTable)
    .set({ isRead: true })
    .where(
      and(
        eq(filmNotificationsTable.fromUserId, otherUserId),
        eq(filmNotificationsTable.toUserId, clerkUserId),
        eq(filmNotificationsTable.isRead, false)
      )
    );

  res.json({ sender: sender ?? null, feed });
});

// ── POST /notifications/thread/:userId/messages ───────────────────────────────
// Send a reaction/message from the fixed vocabulary — either a reply to a
// specific film recommendation, or a standalone message. Works even when no
// recommendation exists between the two users, as long as either follows the
// other (mirrors the reciprocity already implied by /notifications).

router.post("/notifications/thread/:userId/messages", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const otherUserId = String(req.params.userId ?? "").trim();
  if (!otherUserId) { res.status(400).json({ error: "userId is required" }); return; }
  if (otherUserId === clerkUserId) { res.status(400).json({ error: "Cannot message yourself." }); return; }

  const body = SendConversationMessageBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const { content, replyToNotificationId } = body.data;

  const [recipient] = await db
    .select({ clerkId: usersTable.clerkId, expoPushToken: usersTable.expoPushToken })
    .from(usersTable)
    .where(eq(usersTable.clerkId, otherUserId));
  if (!recipient) { res.status(404).json({ error: "User not found." }); return; }

  if (!(await canMessage(clerkUserId, otherUserId))) {
    res.status(403).json({ error: "You can only message people you follow or who follow you." });
    return;
  }

  let replyToFilmTitle: string | null = null;
  if (replyToNotificationId != null) {
    const [notif] = await db
      .select({ id: filmNotificationsTable.id, filmTitle: filmNotificationsTable.filmTitle, fromUserId: filmNotificationsTable.fromUserId, toUserId: filmNotificationsTable.toUserId })
      .from(filmNotificationsTable)
      .where(eq(filmNotificationsTable.id, replyToNotificationId));

    const involvesBothUsers =
      notif &&
      ((notif.fromUserId === clerkUserId && notif.toUserId === otherUserId) ||
        (notif.fromUserId === otherUserId && notif.toUserId === clerkUserId));

    if (!involvesBothUsers) {
      res.status(404).json({ error: "Recommendation not found." });
      return;
    }
    replyToFilmTitle = notif.filmTitle;
  }

  const [inserted] = await db
    .insert(conversationMessagesTable)
    .values({ fromUserId: clerkUserId, toUserId: otherUserId, content, replyToNotificationId: replyToNotificationId ?? null })
    .returning();

  // Best-effort push to the recipient
  const pushToken = recipient.expoPushToken;
  if (pushToken && Expo.isExpoPushToken(pushToken)) {
    const [sender] = await db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
    try {
      await expo.sendPushNotificationsAsync([{
        to: pushToken,
        title: `🎬 ${sender?.username ?? "Someone"}`,
        body: replyToFilmTitle ? `${content} (re: "${replyToFilmTitle}")` : content,
        data: { screen: "/(tabs)/notifications" },
        sound: "default",
      }]);
    } catch { /* non-fatal */ }
  }

  res.status(201).json({
    type: "message",
    id: inserted.id,
    fromUserId: inserted.fromUserId,
    toUserId: inserted.toUserId,
    createdAt: inserted.createdAt,
    tmdbId: null,
    filmTitle: null,
    posterUrl: null,
    isRead: null,
    content: inserted.content,
    replyToNotificationId: inserted.replyToNotificationId,
    replyToFilmTitle,
  });
});

export default router;
