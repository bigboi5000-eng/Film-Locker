import { Router, type IRouter } from "express";
import { and, eq, avg, count, desc, inArray } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { db, filmCommunityRatingsTable, filmCommentsTable, usersTable, followsTable } from "@workspace/db";
import {
  GetFilmCommunityScoreParams,
  GetFilmCommunityScoreResponse,
  SetFilmCommunityRatingParams,
  SetFilmCommunityRatingBody,
  SetFilmCommunityRatingResponse,
  GetFilmCommentsParams,
  GetFilmCommentsQueryParams,
  GetFilmCommentsResponse,
  PostFilmCommentParams,
  PostFilmCommentBody,
  PostFilmCommentResponse,
  DeleteFilmCommentParams,
} from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../../middlewares/requireAuth";

const router: IRouter = Router();

const PAGE_SIZE = 20;

// ── GET /films/:tmdbId/community-score ────────────────────────────────────────

router.get("/films/:tmdbId/community-score", async (req, res): Promise<void> => {
  const params = GetFilmCommunityScoreParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { tmdbId } = params.data;

  // Optional auth — identify if the user is logged in to return their own rating
  const clerkUserId: string | undefined = getAuth(req)?.userId ?? undefined;

  const [agg] = await db
    .select({
      average: avg(filmCommunityRatingsTable.rating),
      count: count(filmCommunityRatingsTable.id),
    })
    .from(filmCommunityRatingsTable)
    .where(eq(filmCommunityRatingsTable.tmdbId, tmdbId));

  let userRating: number | null = null;
  if (clerkUserId) {
    const [own] = await db
      .select({ rating: filmCommunityRatingsTable.rating })
      .from(filmCommunityRatingsTable)
      .where(
        and(
          eq(filmCommunityRatingsTable.tmdbId, tmdbId),
          eq(filmCommunityRatingsTable.userId, clerkUserId)
        )
      );
    userRating = own?.rating ?? null;
  }

  const average = agg?.average ? parseFloat(String(agg.average)) : null;
  const total = agg?.count ? Number(agg.count) : 0;

  res.json(
    GetFilmCommunityScoreResponse.parse({
      tmdbId,
      average,
      count: total,
      userRating,
    })
  );
});

// ── POST /films/:tmdbId/community-rating ──────────────────────────────────────

router.post("/films/:tmdbId/community-rating", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  const params = SetFilmCommunityRatingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = SetFilmCommunityRatingBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { tmdbId } = params.data;
  const { rating } = body.data;

  await db
    .insert(filmCommunityRatingsTable)
    .values({ userId: clerkUserId, tmdbId, rating })
    .onConflictDoUpdate({
      target: [filmCommunityRatingsTable.userId, filmCommunityRatingsTable.tmdbId],
      set: { rating },
    });

  const [agg] = await db
    .select({
      average: avg(filmCommunityRatingsTable.rating),
      count: count(filmCommunityRatingsTable.id),
    })
    .from(filmCommunityRatingsTable)
    .where(eq(filmCommunityRatingsTable.tmdbId, tmdbId));

  const average = agg?.average ? parseFloat(String(agg.average)) : null;
  const total = agg?.count ? Number(agg.count) : 0;

  res.json(
    SetFilmCommunityRatingResponse.parse({
      tmdbId,
      average,
      count: total,
      userRating: rating,
    })
  );
});

// ── GET /films/:tmdbId/comments ───────────────────────────────────────────────

router.get("/films/:tmdbId/comments", async (req, res): Promise<void> => {
  const params = GetFilmCommentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const query = GetFilmCommentsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { tmdbId } = params.data;
  const page = query.data.page ?? 1;
  const offset = (page - 1) * PAGE_SIZE;

  const clerkUserId: string | undefined = getAuth(req)?.userId ?? undefined;

  // Fetch comments with user profile join
  const rows = await db
    .select({
      id: filmCommentsTable.id,
      tmdbId: filmCommentsTable.tmdbId,
      userId: filmCommentsTable.userId,
      body: filmCommentsTable.body,
      createdAt: filmCommentsTable.createdAt,
      updatedAt: filmCommentsTable.updatedAt,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
      isPrivate: usersTable.isPrivate,
    })
    .from(filmCommentsTable)
    .leftJoin(usersTable, eq(filmCommentsTable.userId, usersTable.clerkId))
    .where(eq(filmCommentsTable.tmdbId, tmdbId))
    .orderBy(desc(filmCommentsTable.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset(offset);

  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = rows.slice(0, PAGE_SIZE);

  // Private authors' comments are followers-only — resolve which of this
  // page's private authors the viewer has an accepted follow on.
  const privateAuthorIds = [
    ...new Set(pageRows.filter((r) => r.isPrivate && r.userId !== clerkUserId).map((r) => r.userId)),
  ];
  let followedPrivateAuthorIds = new Set<string>();
  if (clerkUserId && privateAuthorIds.length > 0) {
    const accepted = await db
      .select({ followeeId: followsTable.followeeId })
      .from(followsTable)
      .where(
        and(
          eq(followsTable.followerId, clerkUserId),
          eq(followsTable.status, "accepted"),
          inArray(followsTable.followeeId, privateAuthorIds)
        )
      );
    followedPrivateAuthorIds = new Set(accepted.map((a) => a.followeeId));
  }

  const comments = pageRows
    .filter(
      (r) => !r.isPrivate || r.userId === clerkUserId || followedPrivateAuthorIds.has(r.userId)
    )
    .map((r) => ({
      id: r.id,
      tmdbId: r.tmdbId,
      userId: r.userId,
      username: r.username ?? null,
      avatarUrl: r.avatarUrl ?? null,
      body: r.body,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      isOwn: clerkUserId ? r.userId === clerkUserId : false,
    }));

  res.json(GetFilmCommentsResponse.parse({ comments, page, hasMore }));
});

// ── POST /films/:tmdbId/comments ──────────────────────────────────────────────

router.post("/films/:tmdbId/comments", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  const params = PostFilmCommentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = PostFilmCommentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { tmdbId } = params.data;

  const [inserted] = await db
    .insert(filmCommentsTable)
    .values({ userId: clerkUserId, tmdbId, body: body.data.body })
    .returning();

  // Look up user profile for the response
  const [user] = await db
    .select({ username: usersTable.username, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkUserId));

  res.status(201).json(
    PostFilmCommentResponse.parse({
      id: inserted.id,
      tmdbId: inserted.tmdbId,
      userId: inserted.userId,
      username: user?.username ?? null,
      avatarUrl: user?.avatarUrl ?? null,
      body: inserted.body,
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
      isOwn: true,
    })
  );
});

// ── DELETE /films/:tmdbId/comments/:id ───────────────────────────────────────

router.delete("/films/:tmdbId/comments/:id", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  const params = DeleteFilmCommentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { tmdbId, id } = params.data;

  const [deleted] = await db
    .delete(filmCommentsTable)
    .where(
      and(
        eq(filmCommentsTable.id, id),
        eq(filmCommentsTable.tmdbId, tmdbId),
        eq(filmCommentsTable.userId, clerkUserId)
      )
    )
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Comment not found or you do not own it" });
    return;
  }

  res.sendStatus(204);
});

export default router;
