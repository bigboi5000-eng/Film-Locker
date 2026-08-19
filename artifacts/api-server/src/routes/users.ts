import { Router, type IRouter } from "express";
import { eq, or, ilike } from "drizzle-orm";
import {
  db,
  usersTable,
  moviesTable,
  followsTable,
  filmNotificationsTable,
  conversationMessagesTable,
  filmCommentsTable,
  filmCommunityRatingsTable,
  playlistsTable,
  feedbackTable,
  blocksTable,
  reportsTable,
} from "@workspace/db";
import { UpdatePushTokenBody } from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { z } from "zod";

const router: IRouter = Router();

const SyncUserBody = z.object({
  email: z.string().email(),
  avatarUrl: z.string().optional().nullable(),
  username: z.string().optional().nullable(),
});

const UpdateMeBody = z.object({
  username: z.string().min(2).max(30).optional(),
  displayInitials: z.string().max(5).nullable().optional(),
  isPrivate: z.boolean().optional(),
});

// ── POST /users/sync ──────────────────────────────────────────────────────────
// JIT-provision the authenticated user's row in the users table.
// Called on every sign-in; idempotent — safe to call multiple times.

router.post("/users/sync", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const parsed = SyncUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  const { email, avatarUrl, username } = parsed.data;

  const [row] = await db
    .insert(usersTable)
    .values({
      clerkId: clerkUserId,
      email,
      avatarUrl: avatarUrl ?? null,
      username: username ?? null,
    })
    .onConflictDoUpdate({
      target: usersTable.clerkId,
      set: {
        email,
        // Only overwrite avatarUrl if provided
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      },
    })
    .returning();

  res.json({
    clerkId: row.clerkId,
    email: row.email,
    username: row.username,
    displayInitials: row.displayInitials,
    isPrivate: row.isPrivate,
    avatarUrl: row.avatarUrl,
  });
});

// ── GET /users/me ─────────────────────────────────────────────────────────────

router.get("/users/me", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  const [row] = await db
    .select({
      clerkId: usersTable.clerkId,
      email: usersTable.email,
      username: usersTable.username,
      displayInitials: usersTable.displayInitials,
      isPrivate: usersTable.isPrivate,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkUserId));

  if (!row) {
    res.status(404).json({ error: "User profile not found. Please sync first." });
    return;
  }

  res.json(row);
});

// ── PUT /users/me ─────────────────────────────────────────────────────────────

router.put("/users/me", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [row] = await db
    .update(usersTable)
    .set(parsed.data)
    .where(eq(usersTable.clerkId, clerkUserId))
    .returning();

  if (!row) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  res.json({
    clerkId: row.clerkId,
    email: row.email,
    username: row.username,
    displayInitials: row.displayInitials,
    isPrivate: row.isPrivate,
    avatarUrl: row.avatarUrl,
  });
});

// ── DELETE /users/me ───────────────────────────────────────────────────────────
// Permanently deletes every row this app holds for the user — their locker,
// comments, ratings, notifications, messages, follows (both directions),
// playlists (playlist_items cascade via FK), and feedback — before the
// client deletes the Clerk identity itself. Deliberately does not touch
// Clerk; called from the app just before clerkUser.delete() so the two
// stay in sync for the one deletion path the app actually exposes.

router.delete("/users/me", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  await db.transaction(async (tx) => {
    await tx
      .delete(conversationMessagesTable)
      .where(
        or(
          eq(conversationMessagesTable.fromUserId, clerkUserId),
          eq(conversationMessagesTable.toUserId, clerkUserId)
        )
      );
    await tx
      .delete(filmNotificationsTable)
      .where(
        or(
          eq(filmNotificationsTable.fromUserId, clerkUserId),
          eq(filmNotificationsTable.toUserId, clerkUserId)
        )
      );
    await tx
      .delete(followsTable)
      .where(
        or(
          eq(followsTable.followerId, clerkUserId),
          eq(followsTable.followeeId, clerkUserId)
        )
      );
    await tx
      .delete(blocksTable)
      .where(
        or(
          eq(blocksTable.blockerId, clerkUserId),
          eq(blocksTable.blockedId, clerkUserId)
        )
      );
    // Reports you filed are yours to delete. Reports filed about you are
    // retained as a safety record — deleting your account shouldn't erase
    // evidence someone else submitted about your conduct.
    await tx.delete(reportsTable).where(eq(reportsTable.reporterId, clerkUserId));
    await tx.delete(filmCommentsTable).where(eq(filmCommentsTable.userId, clerkUserId));
    await tx.delete(filmCommunityRatingsTable).where(eq(filmCommunityRatingsTable.userId, clerkUserId));
    await tx.delete(playlistsTable).where(eq(playlistsTable.userId, clerkUserId));
    await tx.delete(feedbackTable).where(eq(feedbackTable.userId, clerkUserId));
    await tx.delete(moviesTable).where(eq(moviesTable.clerkUserId, clerkUserId));
    await tx.delete(usersTable).where(eq(usersTable.clerkId, clerkUserId));
  });

  res.status(204).send();
});

// ── GET /users/search?q= ──────────────────────────────────────────────────────
// Search users by username or email (partial match, case-insensitive) — the
// response never includes another user's email address, only their public
// profile fields.
// Never returns the calling user themselves.

router.get("/users/search", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const q = String(req.query.q ?? "").trim();

  if (!q || q.length < 2) {
    res.status(400).json({ error: "q must be at least 2 characters" });
    return;
  }

  const pattern = `%${q}%`;

  const rows = await db
    .select({
      clerkId: usersTable.clerkId,
      username: usersTable.username,
      displayInitials: usersTable.displayInitials,
      isPrivate: usersTable.isPrivate,
      avatarUrl: usersTable.avatarUrl,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(
      or(
        ilike(usersTable.username, pattern),
        ilike(usersTable.email, pattern)
      )
    )
    .limit(20);

  // Exclude self, and never expose another user's email address in the response
  const users = rows
    .filter((r) => r.clerkId !== clerkUserId)
    .map(({ clerkId, username, displayInitials, isPrivate, avatarUrl }) => ({ clerkId, username, displayInitials, isPrivate, avatarUrl }));

  res.json({ users });
});

// ── PUT /users/push-token ─────────────────────────────────────────────────────

router.put("/users/push-token", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  const body = UpdatePushTokenBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { expoPushToken } = body.data;

  await db
    .update(usersTable)
    .set({ expoPushToken })
    .where(eq(usersTable.clerkId, clerkUserId));

  res.status(204).send();
});

export default router;
