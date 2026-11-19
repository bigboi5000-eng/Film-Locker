import { Router, type IRouter } from "express";
import { and, eq, avg, count, desc, notInArray, or, sql } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import {
  db,
  filmCommunityRatingsTable,
  filmCommentsTable,
  usersTable,
  followsTable,
  moviesTable,
} from "@workspace/db";
import {
  GetFilmCommunityScoreParams,
  GetFilmCommunityScoreResponse,
  SetFilmCommunityRatingParams,
  SetFilmCommunityRatingBody,
  SetFilmCommunityRatingResponse,
  DeleteFilmCommunityRatingParams,
  DeleteFilmCommunityRatingResponse,
  GetFilmCommentsParams,
  GetFilmCommentsQueryParams,
  GetFilmCommentsResponse,
  PostFilmCommentParams,
  PostFilmCommentBody,
  PostFilmCommentResponse,
  DeleteFilmCommentParams,
} from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../../middlewares/requireAuth";
import { moderateText } from "../../lib/moderateText";
import { getMutualBlockSet } from "../../lib/blocks";
import { normalizeMediaType } from "../../lib/tmdb";

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
  // Every query in this file matches on the kind as well as the id. A
  // tmdb_id on its own is not a title — film 1399 and series 1399 are
  // different things — so without it a series would be served the film's
  // score, and a star given to one would land on the other.
  const mediaType = normalizeMediaType(req.query.mediaType);
  const isThisTitle = and(
    eq(filmCommunityRatingsTable.tmdbId, tmdbId),
    eq(filmCommunityRatingsTable.mediaType, mediaType),
  );

  // Optional auth — identify if the user is logged in to return their own rating
  const clerkUserId: string | undefined = getAuth(req)?.userId ?? undefined;

  const [agg] = await db
    .select({
      average: avg(filmCommunityRatingsTable.rating),
      count: count(filmCommunityRatingsTable.id),
    })
    .from(filmCommunityRatingsTable)
    .where(isThisTitle);

  let userRating: number | null = null;
  if (clerkUserId) {
    const [own] = await db
      .select({ rating: filmCommunityRatingsTable.rating })
      .from(filmCommunityRatingsTable)
      .where(and(isThisTitle, eq(filmCommunityRatingsTable.userId, clerkUserId)));
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
  // Body first, then query string: the generated client sends it in the
  // body, and the query param is there for anything hitting the URL
  // directly. Either way an absent one is a film.
  const mediaType = normalizeMediaType(body.data.mediaType ?? req.query.mediaType);
  const isThisTitle = and(
    eq(filmCommunityRatingsTable.tmdbId, tmdbId),
    eq(filmCommunityRatingsTable.mediaType, mediaType),
  );

  await db
    .insert(filmCommunityRatingsTable)
    .values({ userId: clerkUserId, tmdbId, mediaType, rating })
    .onConflictDoUpdate({
      // Matches the unique index, which includes media_type — rating a
      // series must not overwrite your rating of the film with the same id.
      target: [
        filmCommunityRatingsTable.userId,
        filmCommunityRatingsTable.tmdbId,
        filmCommunityRatingsTable.mediaType,
      ],
      set: { rating },
    });

  // A public rating is also your own rating of the film, so it carries across
  // to the private one rather than leaving you to give the same stars twice.
  //
  // One direction only. Rating privately must stay private — that is the
  // whole point of a private rating — so PATCH /movies/:id/rating writes
  // nothing here.
  //
  // Only an existing saved row is updated. Creating one would silently add
  // the film to the rater's watchlist, which is not what pressing a star on
  // a public score asks for, and the `where` below simply matches nothing
  // when the film is not saved.
  const mirrored = await db
    .update(moviesTable)
    .set({ rating })
    .where(
      and(
        eq(moviesTable.clerkUserId, clerkUserId),
        eq(moviesTable.tmdbId, tmdbId),
        eq(moviesTable.mediaType, mediaType),
      ),
    )
    .returning({ id: moviesTable.id });

  req.log.info(
    { tmdbId, rating, privateRowsUpdated: mirrored.length },
    "community rating set",
  );

  const [agg] = await db
    .select({
      average: avg(filmCommunityRatingsTable.rating),
      count: count(filmCommunityRatingsTable.id),
    })
    .from(filmCommunityRatingsTable)
    .where(isThisTitle);

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

// ── DELETE /films/:tmdbId/community-rating ────────────────────────────────────

router.delete("/films/:tmdbId/community-rating", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  const params = DeleteFilmCommunityRatingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { tmdbId } = params.data;
  const mediaType = normalizeMediaType(req.query.mediaType);
  const isThisTitle = and(
    eq(filmCommunityRatingsTable.tmdbId, tmdbId),
    eq(filmCommunityRatingsTable.mediaType, mediaType),
  );

  await db
    .delete(filmCommunityRatingsTable)
    .where(and(isThisTitle, eq(filmCommunityRatingsTable.userId, clerkUserId)));

  // Your own rating of the film is deliberately left alone. Setting a
  // community rating copies across to it, so you are not asked for the same
  // stars twice — but withdrawing one is a statement about the public score,
  // not about what you thought of the film. Clearing it here would silently
  // discard a rating you may well have given privately long before.

  const [agg] = await db
    .select({
      average: avg(filmCommunityRatingsTable.rating),
      count: count(filmCommunityRatingsTable.id),
    })
    .from(filmCommunityRatingsTable)
    .where(isThisTitle);

  const average = agg?.average ? parseFloat(String(agg.average)) : null;
  const total = agg?.count ? Number(agg.count) : 0;

  req.log.info({ tmdbId, average, count: total }, "community rating removed");

  res.json(
    DeleteFilmCommunityRatingResponse.parse({
      tmdbId,
      average,
      count: total,
      userRating: null,
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
  const mediaType = normalizeMediaType(req.query.mediaType);
  const page = query.data.page ?? 1;
  const offset = (page - 1) * PAGE_SIZE;

  const clerkUserId: string | undefined = getAuth(req)?.userId ?? undefined;

  // Visibility is resolved in SQL rather than by filtering the fetched page
  // in JS. Filtering afterwards silently shrinks pages (a page whose authors
  // are all hidden comes back empty) and makes `hasMore` describe the
  // unfiltered result, so the client can't tell an exhausted list from a
  // fully-hidden page. Both gates below therefore go into the WHERE clause,
  // where LIMIT/OFFSET see the same rows the viewer will:
  //   • blocks (either direction) hide the author entirely
  //   • a private author's comments are visible only to themselves and to
  //     their accepted followers
  const blockedIds = clerkUserId ? await getMutualBlockSet(clerkUserId) : new Set<string>();

  const visibleToViewer = and(
    eq(filmCommentsTable.tmdbId, tmdbId),
    eq(filmCommentsTable.mediaType, mediaType),
    blockedIds.size > 0 ? notInArray(filmCommentsTable.userId, [...blockedIds]) : undefined,
    or(
      eq(usersTable.isPrivate, false),
      clerkUserId ? eq(filmCommentsTable.userId, clerkUserId) : undefined,
      clerkUserId
        ? sql`EXISTS (
            SELECT 1 FROM ${followsTable}
            WHERE ${followsTable.followerId} = ${clerkUserId}
              AND ${followsTable.followeeId} = ${filmCommentsTable.userId}
              AND ${followsTable.status} = 'accepted'
          )`
        : undefined
    )
  );

  // Fetch comments with user profile join, plus that author's own community
  // rating for this film (if they've left one) so it can show alongside
  // their comment.
  const rows = await db
    .select({
      id: filmCommentsTable.id,
      tmdbId: filmCommentsTable.tmdbId,
      mediaType: filmCommentsTable.mediaType,
      userId: filmCommentsTable.userId,
      body: filmCommentsTable.body,
      createdAt: filmCommentsTable.createdAt,
      updatedAt: filmCommentsTable.updatedAt,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
      rating: filmCommunityRatingsTable.rating,
    })
    .from(filmCommentsTable)
    // Inner, not left: a comment whose author row is missing has no privacy
    // setting to evaluate, so it can't be shown safely.
    .innerJoin(usersTable, eq(filmCommentsTable.userId, usersTable.clerkId))
    .leftJoin(
      filmCommunityRatingsTable,
      and(
        eq(filmCommunityRatingsTable.tmdbId, filmCommentsTable.tmdbId),
        // Joined on the kind too, or a comment on a series would carry the
        // author's rating of the film that shares its id.
        eq(filmCommunityRatingsTable.mediaType, filmCommentsTable.mediaType),
        eq(filmCommunityRatingsTable.userId, filmCommentsTable.userId)
      )
    )
    .where(visibleToViewer)
    .orderBy(desc(filmCommentsTable.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset(offset);

  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = rows.slice(0, PAGE_SIZE);

  const comments = pageRows
    .map((r) => ({
      id: r.id,
      tmdbId: r.tmdbId,
      mediaType: r.mediaType,
      userId: r.userId,
      username: r.username ?? null,
      avatarUrl: r.avatarUrl ?? null,
      body: r.body,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      isOwn: clerkUserId ? r.userId === clerkUserId : false,
      rating: r.rating ?? null,
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
  const mediaType = normalizeMediaType(body.data.mediaType ?? req.query.mediaType);

  // Filter before storing, not after reporting. Guideline 1.2 asks for both,
  // and reporting alone means the objectionable comment is published first
  // and removed only once somebody has seen it and complained.
  //
  // A failure here refuses the comment rather than storing it unchecked: a
  // filter that silently stops filtering when the model is unreachable is
  // the hole the guideline exists to close. Asking someone to try again is
  // recoverable; publishing abuse is not.
  try {
    const verdict = await moderateText(body.data.body);
    if (!verdict.allowed) {
      res.status(422).json({ error: verdict.reason });
      return;
    }
  } catch (err) {
    req.log.error({ err }, "comment moderation failed — refusing the comment");
    res.status(503).json({ error: "We couldn't check that comment just now. Please try again." });
    return;
  }

  const [inserted] = await db
    .insert(filmCommentsTable)
    .values({ userId: clerkUserId, tmdbId, mediaType, body: body.data.body })
    .returning();

  // Look up user profile and their own community rating for this film, for the response
  const [user] = await db
    .select({ username: usersTable.username, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkUserId));

  const [ratingRow] = await db
    .select({ rating: filmCommunityRatingsTable.rating })
    .from(filmCommunityRatingsTable)
    .where(
      and(
        eq(filmCommunityRatingsTable.tmdbId, tmdbId),
        eq(filmCommunityRatingsTable.mediaType, mediaType),
        eq(filmCommunityRatingsTable.userId, clerkUserId)
      )
    );

  res.status(201).json(
    PostFilmCommentResponse.parse({
      id: inserted.id,
      tmdbId: inserted.tmdbId,
      mediaType: inserted.mediaType,
      userId: inserted.userId,
      username: user?.username ?? null,
      avatarUrl: user?.avatarUrl ?? null,
      body: inserted.body,
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
      isOwn: true,
      rating: ratingRow?.rating ?? null,
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
