import { Router, type IRouter } from "express";
import { and, eq, desc, ne } from "drizzle-orm";
import { db, filmNotificationsTable, usersTable } from "@workspace/db";
import {
  SendNotificationBody,
  GetNotificationsResponse,
  SendNotificationResponse,
  MarkNotificationReadParams,
  MarkNotificationReadResponse,
  GetNotificationUsersResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { Expo } from "expo-server-sdk";

const expo = new Expo();

const router: IRouter = Router();

// ── GET /notifications/users ─────────────────────────────────────────────────
// Must be registered before /notifications/:id/read to avoid route collision

router.get("/notifications/users", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  const users = await db
    .select({
      clerkId: usersTable.clerkId,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(usersTable)
    .where(ne(usersTable.clerkId, clerkUserId))
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

export default router;
