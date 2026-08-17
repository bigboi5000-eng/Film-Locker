import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import { db, filmNotificationsTable, usersTable, followsTable } from "@workspace/db";
import {
  SendNotificationBody,
  GetNotificationsResponse,
  SendNotificationResponse,
  MarkNotificationReadParams,
  MarkNotificationReadResponse,
  GetNotificationUsersResponse,
  ReactToNotificationBody,
} from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { Expo } from "expo-server-sdk";

const expo = new Expo();

const router: IRouter = Router();

// ── GET /notifications/users ─────────────────────────────────────────────────
// Returns only users the caller follows. Must be registered before
// /notifications/:id/read to avoid route collision.

router.get("/notifications/users", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  // Join follows → users to return only people this caller follows
  const users = await db
    .select({
      clerkId: usersTable.clerkId,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(followsTable)
    .innerJoin(usersTable, eq(followsTable.followeeId, usersTable.clerkId))
    .where(eq(followsTable.followerId, clerkUserId))
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

  // Enforce follow relationship — caller must follow the recipient
  const [followRow] = await db
    .select({ id: followsTable.id })
    .from(followsTable)
    .where(
      and(
        eq(followsTable.followerId, clerkUserId),
        eq(followsTable.followeeId, toUserId)
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
      .select({ username: usersTable.username, avatarUrl: usersTable.avatarUrl })
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
    .select({ username: usersTable.username, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.clerkId, updated.fromUserId));

  res.json(
    MarkNotificationReadResponse.parse({
      id: updated.id,
      fromUserId: updated.fromUserId,
      fromUsername: sender?.username ?? null,
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

// ── PATCH /notifications/:id/react ───────────────────────────────────────────
// Set a reaction on a notification — a fixed enum (emoji + canned phrases),
// validated by ReactToNotificationBody, not a freeform string. There is no
// messaging feature in this app; this is the only user-to-user "expression"
// endpoint, so the enum is enforced here rather than left to the client UI.

router.patch("/notifications/:id/react", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = ReactToNotificationBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [updated] = await db
    .update(filmNotificationsTable)
    .set({ reaction: body.data.reaction, reactedAt: new Date(), isRead: true })
    .where(
      and(
        eq(filmNotificationsTable.id, id),
        eq(filmNotificationsTable.toUserId, clerkUserId)
      )
    )
    .returning();

  if (!updated) { res.status(404).json({ error: "Notification not found." }); return; }

  // Notify the sender that their recommendation was reacted to
  const [[sender], [recipientWithToken]] = await Promise.all([
    db.select({ username: usersTable.username, expoPushToken: usersTable.expoPushToken })
      .from(usersTable).where(eq(usersTable.clerkId, updated.fromUserId)),
    db.select({ username: usersTable.username })
      .from(usersTable).where(eq(usersTable.clerkId, clerkUserId)),
  ]);

  const senderToken = sender?.expoPushToken;
  if (senderToken && Expo.isExpoPushToken(senderToken)) {
    try {
      await expo.sendPushNotificationsAsync([{
        to: senderToken,
        title: "🎬 Reaction",
        body: `${recipientWithToken?.username ?? "Someone"} reacted ${body.data.reaction} to your "${updated.filmTitle}" recommendation`,
        data: { screen: "/(tabs)/notifications" },
        sound: "default",
      }]);
    } catch { /* non-fatal */ }
  }

  res.json({ id: updated.id, reaction: updated.reaction, reactedAt: updated.reactedAt });
});

// ── GET /notifications/thread/:userId ─────────────────────────────────────────
// All recommendations from a specific user to the authenticated user.

router.get("/notifications/thread/:userId", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const fromUserId = String(req.params.userId ?? "").trim();
  if (!fromUserId) { res.status(400).json({ error: "userId is required" }); return; }

  const [rows, [sender]] = await Promise.all([
    db
      .select({
        id: filmNotificationsTable.id,
        fromUserId: filmNotificationsTable.fromUserId,
        toUserId: filmNotificationsTable.toUserId,
        tmdbId: filmNotificationsTable.tmdbId,
        filmTitle: filmNotificationsTable.filmTitle,
        posterUrl: filmNotificationsTable.posterUrl,
        isRead: filmNotificationsTable.isRead,
        reaction: filmNotificationsTable.reaction,
        reactedAt: filmNotificationsTable.reactedAt,
        createdAt: filmNotificationsTable.createdAt,
      })
      .from(filmNotificationsTable)
      .where(
        and(
          eq(filmNotificationsTable.fromUserId, fromUserId),
          eq(filmNotificationsTable.toUserId, clerkUserId)
        )
      )
      .orderBy(desc(filmNotificationsTable.createdAt)),

    db
      .select({ clerkId: usersTable.clerkId, username: usersTable.username, avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.clerkId, fromUserId)),
  ]);

  // Mark all unread as read in the background
  void db
    .update(filmNotificationsTable)
    .set({ isRead: true })
    .where(
      and(
        eq(filmNotificationsTable.fromUserId, fromUserId),
        eq(filmNotificationsTable.toUserId, clerkUserId),
        eq(filmNotificationsTable.isRead, false)
      )
    );

  res.json({
    sender: sender ?? null,
    notifications: rows.map((r) => ({
      ...r,
      fromUsername: sender?.username ?? null,
      fromAvatarUrl: sender?.avatarUrl ?? null,
    })),
  });
});

export default router;
