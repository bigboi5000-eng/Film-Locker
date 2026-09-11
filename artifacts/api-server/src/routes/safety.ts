import { Router, type IRouter } from "express";
import { and, eq, or } from "drizzle-orm";
import { db, blocksTable, reportsTable, followsTable, filmCommentsTable, usersTable } from "@workspace/db";
import { BlockUserBody, SubmitReportBody } from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { sendReportEmail } from "../lib/email";

const router: IRouter = Router();

// ── GET /blocks ────────────────────────────────────────────────────────────────

router.get("/blocks", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  const blocked = await db
    .select({
      clerkId: usersTable.clerkId,
      username: usersTable.username,
      displayInitials: usersTable.displayInitials,
      isPrivate: usersTable.isPrivate,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(blocksTable)
    .innerJoin(usersTable, eq(blocksTable.blockedId, usersTable.clerkId))
    .where(eq(blocksTable.blockerId, clerkUserId));

  res.json({ blocked });
});

// ── POST /blocks ───────────────────────────────────────────────────────────────
// Blocking also removes any existing follow relationship between the two
// people, in either direction — including a still-pending request, so this
// doubles as "cancel this request" when the target hasn't responded yet.

router.post("/blocks", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const parsed = BlockUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { blockedId } = parsed.data;

  if (blockedId === clerkUserId) {
    res.status(400).json({ error: "You cannot block yourself." });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.insert(blocksTable).values({ blockerId: clerkUserId, blockedId }).onConflictDoNothing();
    await tx
      .delete(followsTable)
      .where(
        or(
          and(eq(followsTable.followerId, clerkUserId), eq(followsTable.followeeId, blockedId)),
          and(eq(followsTable.followerId, blockedId), eq(followsTable.followeeId, clerkUserId))
        )
      );
  });

  res.status(201).json({ blockerId: clerkUserId, blockedId });
});

// ── DELETE /blocks/:userId ─────────────────────────────────────────────────────

router.delete("/blocks/:userId", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const blockedId = String(req.params.userId ?? "").trim();
  if (!blockedId) {
    res.status(400).json({ error: "userId path param is required" });
    return;
  }

  await db
    .delete(blocksTable)
    .where(and(eq(blocksTable.blockerId, clerkUserId), eq(blocksTable.blockedId, blockedId)));

  res.status(204).send();
});

// ── POST /reports ──────────────────────────────────────────────────────────────
// No in-app moderation queue yet — this is emailed to the developer
// best-effort and always saved to the database as the record of truth.

router.post("/reports", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const parsed = SubmitReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { reportedUserId, reason, commentId } = parsed.data;

  if (reportedUserId === clerkUserId) {
    res.status(400).json({ error: "You cannot report yourself." });
    return;
  }

  let commentSnapshot: string | null = null;
  let tmdbId: number | null = null;
  if (commentId != null) {
    const [comment] = await db
      .select({ body: filmCommentsTable.body, tmdbId: filmCommentsTable.tmdbId, userId: filmCommentsTable.userId })
      .from(filmCommentsTable)
      .where(eq(filmCommentsTable.id, commentId));
    if (comment && comment.userId === reportedUserId) {
      commentSnapshot = comment.body;
      tmdbId = comment.tmdbId;
    }
  }

  const [inserted] = await db
    .insert(reportsTable)
    .values({ reporterId: clerkUserId, reportedUserId, reason, commentId: commentId ?? null, commentSnapshot, tmdbId })
    .returning();

  const [[reporter], [reported]] = await Promise.all([
    db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.clerkId, clerkUserId)),
    db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.clerkId, reportedUserId)),
  ]);

  void sendReportEmail({
    reporterEmail: reporter?.email ?? "unknown",
    reportedUserEmail: reported?.email ?? reportedUserId,
    reason,
    commentSnapshot,
  });

  res.status(201).json({ id: inserted.id, createdAt: inserted.createdAt });
});

export default router;
