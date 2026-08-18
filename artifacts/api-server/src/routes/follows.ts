import { Router, type IRouter } from "express";
import { and, eq, or } from "drizzle-orm";
import { db, followsTable, usersTable } from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { z } from "zod";

const router: IRouter = Router();

const FollowBody = z.object({ followeeId: z.string().min(1) });

// ── GET /follows ──────────────────────────────────────────────────────────────
// Returns two lists: people I follow, and people who follow me.

router.get("/follows", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  const [followingRows, followerRows] = await Promise.all([
    db
      .select({
        clerkId: usersTable.clerkId,
        username: usersTable.username,
        displayInitials: usersTable.displayInitials,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(followsTable)
      .innerJoin(usersTable, eq(followsTable.followeeId, usersTable.clerkId))
      .where(eq(followsTable.followerId, clerkUserId)),

    db
      .select({
        clerkId: usersTable.clerkId,
        username: usersTable.username,
        displayInitials: usersTable.displayInitials,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(followsTable)
      .innerJoin(usersTable, eq(followsTable.followerId, usersTable.clerkId))
      .where(eq(followsTable.followeeId, clerkUserId)),
  ]);

  // Build a set of who I follow so the UI can show follow-back state
  const followingIds = new Set(followingRows.map((r) => r.clerkId));

  res.json({
    following: followingRows,
    followers: followerRows.map((r) => ({
      ...r,
      iFollowBack: followingIds.has(r.clerkId),
    })),
  });
});

// ── POST /follows ─────────────────────────────────────────────────────────────
// Follow a user.

router.post("/follows", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const parsed = FollowBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "followeeId is required" });
    return;
  }
  const { followeeId } = parsed.data;

  if (followeeId === clerkUserId) {
    res.status(400).json({ error: "You cannot follow yourself." });
    return;
  }

  // Verify the target user exists
  const [target] = await db
    .select({ clerkId: usersTable.clerkId })
    .from(usersTable)
    .where(eq(usersTable.clerkId, followeeId));

  if (!target) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  // Idempotent — ignore duplicate
  await db
    .insert(followsTable)
    .values({ followerId: clerkUserId, followeeId })
    .onConflictDoNothing();

  res.status(201).json({ followerId: clerkUserId, followeeId });
});

// ── DELETE /follows/:userId ───────────────────────────────────────────────────
// Unfollow a user.

router.delete("/follows/:userId", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const followeeId = String(req.params.userId ?? "").trim();

  if (!followeeId) {
    res.status(400).json({ error: "userId path param is required" });
    return;
  }

  await db
    .delete(followsTable)
    .where(
      and(
        eq(followsTable.followerId, clerkUserId),
        eq(followsTable.followeeId, followeeId)
      )
    );

  res.status(204).send();
});

export default router;
