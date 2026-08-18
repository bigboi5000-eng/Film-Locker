import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, followsTable, usersTable } from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { z } from "zod";

const router: IRouter = Router();

const FollowBody = z.object({ followeeId: z.string().min(1) });

const PUBLIC_PROFILE_COLUMNS = {
  clerkId: usersTable.clerkId,
  username: usersTable.username,
  displayInitials: usersTable.displayInitials,
  isPrivate: usersTable.isPrivate,
  avatarUrl: usersTable.avatarUrl,
};

// ── GET /follows ──────────────────────────────────────────────────────────────
// Four lists: people I actively follow, people who follow me (both accepted
// only), and the pending follow requests in each direction.

router.get("/follows", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  const [followingRows, followerRows, incomingRequestRows, outgoingRequestRows] = await Promise.all([
    db
      .select(PUBLIC_PROFILE_COLUMNS)
      .from(followsTable)
      .innerJoin(usersTable, eq(followsTable.followeeId, usersTable.clerkId))
      .where(and(eq(followsTable.followerId, clerkUserId), eq(followsTable.status, "accepted"))),

    db
      .select(PUBLIC_PROFILE_COLUMNS)
      .from(followsTable)
      .innerJoin(usersTable, eq(followsTable.followerId, usersTable.clerkId))
      .where(and(eq(followsTable.followeeId, clerkUserId), eq(followsTable.status, "accepted"))),

    // People who have requested to follow me — awaiting my accept/decline
    db
      .select(PUBLIC_PROFILE_COLUMNS)
      .from(followsTable)
      .innerJoin(usersTable, eq(followsTable.followerId, usersTable.clerkId))
      .where(and(eq(followsTable.followeeId, clerkUserId), eq(followsTable.status, "pending"))),

    // People I've requested to follow — awaiting their accept/decline
    db
      .select(PUBLIC_PROFILE_COLUMNS)
      .from(followsTable)
      .innerJoin(usersTable, eq(followsTable.followeeId, usersTable.clerkId))
      .where(and(eq(followsTable.followerId, clerkUserId), eq(followsTable.status, "pending"))),
  ]);

  // Build a set of who I follow so the UI can show follow-back state
  const followingIds = new Set(followingRows.map((r) => r.clerkId));

  res.json({
    following: followingRows,
    followers: followerRows.map((r) => ({
      ...r,
      iFollowBack: followingIds.has(r.clerkId),
    })),
    incomingRequests: incomingRequestRows,
    outgoingRequests: outgoingRequestRows,
  });
});

// ── POST /follows ─────────────────────────────────────────────────────────────
// Follow a user. Public accounts are followed immediately; private accounts
// require the followee to accept via PATCH /follows/:userId/accept.

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

  const [target] = await db
    .select({ clerkId: usersTable.clerkId, isPrivate: usersTable.isPrivate })
    .from(usersTable)
    .where(eq(usersTable.clerkId, followeeId));

  if (!target) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  const status = target.isPrivate ? "pending" : "accepted";

  // Idempotent — a repeat follow/request while one already exists just
  // returns the existing row's actual status rather than erroring.
  const [inserted] = await db
    .insert(followsTable)
    .values({ followerId: clerkUserId, followeeId, status })
    .onConflictDoNothing()
    .returning();

  const row =
    inserted ??
    (
      await db
        .select()
        .from(followsTable)
        .where(and(eq(followsTable.followerId, clerkUserId), eq(followsTable.followeeId, followeeId)))
    )[0];

  res.status(201).json({ followerId: clerkUserId, followeeId, status: row?.status ?? status });
});

// ── PATCH /follows/:userId/accept ─────────────────────────────────────────────
// Accept an incoming follow request from userId.

router.patch("/follows/:userId/accept", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const followerId = String(req.params.userId ?? "").trim();
  if (!followerId) { res.status(400).json({ error: "userId path param is required" }); return; }

  const [updated] = await db
    .update(followsTable)
    .set({ status: "accepted" })
    .where(
      and(
        eq(followsTable.followerId, followerId),
        eq(followsTable.followeeId, clerkUserId),
        eq(followsTable.status, "pending")
      )
    )
    .returning();

  if (!updated) {
    res.status(404).json({ error: "No pending request from this user." });
    return;
  }

  res.json({ followerId: updated.followerId, followeeId: updated.followeeId, status: updated.status });
});

// ── DELETE /follows/:userId/request ───────────────────────────────────────────
// Decline an incoming pending follow request from userId.

router.delete("/follows/:userId/request", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const followerId = String(req.params.userId ?? "").trim();
  if (!followerId) { res.status(400).json({ error: "userId path param is required" }); return; }

  await db
    .delete(followsTable)
    .where(
      and(
        eq(followsTable.followerId, followerId),
        eq(followsTable.followeeId, clerkUserId),
        eq(followsTable.status, "pending")
      )
    );

  res.status(204).send();
});

// ── DELETE /follows/:userId ───────────────────────────────────────────────────
// Unfollow a user, or cancel an outgoing follow request you sent them —
// both are just removing the edge from me to them, regardless of status.

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
