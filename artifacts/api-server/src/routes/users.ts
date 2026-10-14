import { Router, type IRouter } from "express";
import { clerkClient } from "@clerk/express";
import { eq, or, and, ilike, count, desc, sql } from "drizzle-orm";
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
  playlistItemsTable,
  playlistFollowsTable,
  feedbackTable,
  blocksTable,
  reportsTable,
} from "@workspace/db";
import { UpdatePushTokenBody, ListMoviesResponse } from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { isBlockedEitherWay } from "../lib/blocks";
import { resolveFilmCards, type FilmCard } from "../lib/filmCards";
import { deleteUserData } from "../lib/deleteUserData";
import { generateUsername } from "../lib/generateUsername";
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

  // Nobody gets to stay nameless. An account with no username displayed as
  // "Unnamed user" beside its own comments, which is posting anonymously —
  // the thing guideline 1.2 rejected the app over. Filling it in here rather
  // than demanding it through a form means the account is attributable from
  // its first action, with nothing to skip or dismiss. The user can change
  // it in Profile; they cannot end up without one.
  //
  // Best-effort on purpose: a failure to find a free name must not break
  // sign-in, and the next sync will try again.
  let finalRow = row;
  if (!finalRow.username) {
    const generated = await generateUsername(email);
    if (generated) {
      try {
        const [updated] = await db
          .update(usersTable)
          .set({ username: generated })
          .where(eq(usersTable.clerkId, clerkUserId))
          .returning();
        if (updated) finalRow = updated;
      } catch (err) {
        // Lost a race for the same name. Harmless — next sync picks another.
        req.log.warn({ err, generated }, "sync: generated username was taken");
      }
    }
  }

  res.json({
    clerkId: finalRow.clerkId,
    email: finalRow.email,
    username: finalRow.username,
    displayInitials: finalRow.displayInitials,
    isPrivate: finalRow.isPrivate,
    avatarUrl: finalRow.avatarUrl,
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

/**
 * Postgres reports a violated unique constraint as SQLSTATE 23505. Drizzle
 * passes the driver's error through, so the code is read off the error rather
 * than matched against its message, which is not stable.
 */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505";
}

// ── PUT /users/me ─────────────────────────────────────────────────────────────

router.put("/users/me", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Usernames are unique, and case-insensitively so. Without this catch a
  // clash surfaced as an unhandled Postgres error and a 500 with no
  // explanation — the one failure here a user can actually do something
  // about, reported as though the server had broken.
  let row;
  try {
    [row] = await db
      .update(usersTable)
      .set(parsed.data)
      .where(eq(usersTable.clerkId, clerkUserId))
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "That username is already taken." });
      return;
    }
    throw err;
  }

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

  await deleteUserData(clerkUserId);

  // Delete the Clerk identity here rather than from the app.
  //
  // The client used to call user.delete() itself once this returned, and it
  // failed with "needs to supply an active session": Clerk treats deleting a
  // user as a sensitive action behind reverification, and native support for
  // that prompt is still being built. The result was the worst possible
  // split — every row above deleted, the Clerk account still alive, and the
  // user able to sign back in to an empty locker as though nothing had
  // happened.
  //
  // From here it is a backend call authenticated by the secret key, so no
  // reverification applies. Deliberately after the rows are gone: if this
  // throws, the account still exists and the user can sign in and retry,
  // which is recoverable. The reverse — identity gone, rows behind it — is
  // not.
  try {
    await clerkClient.users.deleteUser(clerkUserId);
  } catch (err) {
    req.log.error({ err, clerkUserId }, "account deletion: Clerk user delete failed");
    res.status(502).json({
      error: "Your data was deleted, but the account itself could not be removed. Please try again.",
    });
    return;
  }

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

// ── GET /users/:id/profile ─────────────────────────────────────────────────────
// Another user's public profile: their PublicUserProfile fields, the
// caller's follow status toward them, headline stats (films watched,
// reviews given, public playlist count — always shown, even for a private
// account the caller doesn't follow), and their public playlists — the
// actual list is only included when the account is public, the caller is
// the account itself, or the caller is an accepted follower; otherwise
// publicPlaylists is null and only the count above stands in for it.

router.get("/users/:id/profile", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const targetId = String(req.params.id ?? "").trim();
  if (!targetId) {
    res.status(400).json({ error: "id path param is required" });
    return;
  }

  const [target] = await db
    .select({
      clerkId: usersTable.clerkId,
      username: usersTable.username,
      displayInitials: usersTable.displayInitials,
      isPrivate: usersTable.isPrivate,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(usersTable)
    .where(eq(usersTable.clerkId, targetId));

  // Treat a blocked-either-way relationship the same as "not found" —
  // matches how blocks are enforced elsewhere, and doesn't reveal that a
  // block exists.
  if (!target || (await isBlockedEitherWay(clerkUserId, targetId))) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  const isSelf = clerkUserId === targetId;

  let followStatus: "self" | "none" | "pending" | "accepted" = "self";
  // The reverse edge matters to the caller now that messaging requires a
  // mutual follow: without it the app can show that you follow someone but
  // not why the conversation is unavailable.
  let followsYou = false;
  if (!isSelf) {
    const [[edge], [reverseEdge]] = await Promise.all([
      db
        .select({ status: followsTable.status })
        .from(followsTable)
        .where(and(eq(followsTable.followerId, clerkUserId), eq(followsTable.followeeId, targetId))),
      db
        .select({ status: followsTable.status })
        .from(followsTable)
        .where(and(eq(followsTable.followerId, targetId), eq(followsTable.followeeId, clerkUserId))),
    ]);
    followStatus = edge ? (edge.status as "pending" | "accepted") : "none";
    // A pending request the other way is not a follow yet, so it does not
    // count — only an accepted one puts them on the way to being Film Pals.
    followsYou = reverseEdge?.status === "accepted";
  }

  const canViewDetails = isSelf || !target.isPrivate || followStatus === "accepted";

  const [[watchedRow], [reviewRow], [playlistCountRow], [followerRow], [followingRow]] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(moviesTable)
        .where(and(eq(moviesTable.clerkUserId, targetId), eq(moviesTable.isWatched, true))),
      db.select({ value: count() }).from(filmCommentsTable).where(eq(filmCommentsTable.userId, targetId)),
      db
        .select({ value: count() })
        .from(playlistsTable)
        .where(and(eq(playlistsTable.userId, targetId), eq(playlistsTable.isPublic, true))),
      db
        .select({ value: count() })
        .from(followsTable)
        .where(and(eq(followsTable.followeeId, targetId), eq(followsTable.status, "accepted"))),
      db
        .select({ value: count() })
        .from(followsTable)
        .where(and(eq(followsTable.followerId, targetId), eq(followsTable.status, "accepted"))),
    ]);

  let publicPlaylists = null;
  if (canViewDetails) {
    const rows = await db
      .select({
        id: playlistsTable.id,
        userId: playlistsTable.userId,
        name: playlistsTable.name,
        description: playlistsTable.description,
        isPublic: playlistsTable.isPublic,
        createdAt: playlistsTable.createdAt,
        updatedAt: playlistsTable.updatedAt,
        itemCount: count(playlistItemsTable.id),
        coverPosters: sql<string[]>`
          array_agg(${playlistItemsTable.posterUrl} ORDER BY ${playlistItemsTable.addedAt} DESC)
          FILTER (WHERE ${playlistItemsTable.id} IS NOT NULL)
        `.as("cover_posters"),
      })
      .from(playlistsTable)
      .leftJoin(playlistItemsTable, eq(playlistItemsTable.playlistId, playlistsTable.id))
      .where(and(eq(playlistsTable.userId, targetId), eq(playlistsTable.isPublic, true)))
      .groupBy(playlistsTable.id)
      .orderBy(desc(playlistsTable.updatedAt));

    publicPlaylists = rows.map((r) => ({ ...r, coverPosters: (r.coverPosters ?? []).slice(0, 4) }));
  }

  /**
   * What the profile actually shows.
   *
   * Three sections, three different privacy bars, which is the whole reason
   * they are fetched separately rather than as one activity list:
   *
   *  - ratings and comments ride on canViewDetails, the same one-way bar
   *    the playlists use;
   *  - watched films need a mutual follow, matching GET /users/:id/watched.
   *    That gate is why a profile's headline imagery cannot come from here:
   *    for anybody you have just discovered this is null, and a hero built
   *    on it would be blank exactly when a profile most needs to look
   *    worth following.
   */
  const RECENT_RATINGS = 12;
  const RECENT_COMMENTS = 3;
  const RECENT_WATCHED = 12;

  const canViewWatched = isSelf || (followStatus === "accepted" && followsYou);

  const [ratingRows, commentRows, watchedRows] = await Promise.all([
    canViewDetails
      ? db
          .select({
            tmdbId: filmCommunityRatingsTable.tmdbId,
            rating: filmCommunityRatingsTable.rating,
            at: filmCommunityRatingsTable.createdAt,
          })
          .from(filmCommunityRatingsTable)
          .where(eq(filmCommunityRatingsTable.userId, targetId))
          .orderBy(desc(filmCommunityRatingsTable.createdAt))
          .limit(RECENT_RATINGS)
      : Promise.resolve(null),

    canViewDetails
      ? db
          .select({
            tmdbId: filmCommentsTable.tmdbId,
            body: filmCommentsTable.body,
            at: filmCommentsTable.createdAt,
          })
          .from(filmCommentsTable)
          .where(eq(filmCommentsTable.userId, targetId))
          .orderBy(desc(filmCommentsTable.createdAt))
          .limit(RECENT_COMMENTS)
      : Promise.resolve(null),

    canViewWatched
      ? db
          .select({
            tmdbId: moviesTable.tmdbId,
            title: moviesTable.title,
            posterUrl: moviesTable.posterUrl,
            releaseYear: moviesTable.releaseYear,
            rating: moviesTable.rating,
            watchedAt: moviesTable.watchedAt,
            addedAt: moviesTable.addedAt,
          })
          .from(moviesTable)
          .where(and(eq(moviesTable.clerkUserId, targetId), eq(moviesTable.isWatched, true)))
          // Coalesced, not "watched_at DESC, added_at DESC". Postgres sorts
          // NULLs first on a descending order, and watched_at is null on
          // rows marked watched before that column existed — so the plain
          // version puts the oldest entries in the library at the top of a
          // section headed "Recently watched".
          .orderBy(desc(sql`coalesce(${moviesTable.watchedAt}, ${moviesTable.addedAt})`))
          .limit(RECENT_WATCHED)
      : Promise.resolve(null),
  ]);

  // Ratings and comments keep a TMDB id and nothing else, so one resolve
  // covers both — and the two sections overlap heavily in practice, since
  // people tend to write about the films they rate.
  const needsResolving = [
    ...(ratingRows ?? []).map((r) => r.tmdbId),
    ...(commentRows ?? []).map((c) => c.tmdbId),
  ];
  const cards: Map<number, FilmCard> = needsResolving.length
    ? await resolveFilmCards(needsResolving)
    : new Map();

  const card = (tmdbId: number) => cards.get(tmdbId);

  const recentRatings =
    ratingRows === null
      ? null
      : ratingRows.map((r) => ({
          tmdbId: r.tmdbId,
          title: card(r.tmdbId)?.title ?? null,
          posterUrl: card(r.tmdbId)?.posterUrl ?? null,
          releaseYear: card(r.tmdbId)?.releaseYear ?? null,
          rating: r.rating,
          comment: null,
          at: r.at,
        }));

  const recentComments =
    commentRows === null
      ? null
      : commentRows.map((c) => ({
          tmdbId: c.tmdbId,
          title: card(c.tmdbId)?.title ?? null,
          posterUrl: card(c.tmdbId)?.posterUrl ?? null,
          releaseYear: card(c.tmdbId)?.releaseYear ?? null,
          rating: null,
          comment: c.body,
          at: c.at,
        }));

  const recentWatched =
    watchedRows === null
      ? null
      : watchedRows.map((m) => ({
          tmdbId: m.tmdbId,
          title: m.title,
          posterUrl: m.posterUrl || null,
          releaseYear: m.releaseYear || null,
          rating: m.rating,
          comment: null,
          // watchedAt is nullable on rows marked watched before it existed.
          at: m.watchedAt ?? m.addedAt,
        }));

  res.json({
    user: target,
    followStatus,
    followsYou,
    stats: {
      watchedCount: watchedRow.value,
      reviewCount: reviewRow.value,
      publicPlaylistCount: playlistCountRow.value,
      followerCount: followerRow.value,
      followingCount: followingRow.value,
    },
    publicPlaylists,
    recentRatings,
    recentComments,
    recentWatched,
  });
});

// ── GET /users/:id/watched ───────────────────────────────────────────────────
// Another user's watched films. Gated on a MUTUAL accepted follow (both
// directions — i.e. "Film Pals") rather than the one-way accepted-follower
// gate used for playlists: individual watched films are more personal than
// a curated public playlist, so this uses the stricter bar.

// ── GET /users/:id/followers and /users/:id/following ────────────────────────
// Who follows this person, and who they follow.
//
// The counts on the profile are public; these lists are not. A private
// account's lists are visible only to the account itself and to accepted
// followers — the same one-way bar the playlists use, rather than the
// mutual one guarding watched films, because who somebody follows is far
// less personal than what they have been watching.

/** Both lists need the same four checks, so they share them. */
async function resolveListAccess(
  callerId: string,
  targetId: string
): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
  if (!targetId) {
    return { ok: false, status: 404, error: "User not found." };
  }

  const [target] = await db
    .select({ clerkId: usersTable.clerkId, isPrivate: usersTable.isPrivate })
    .from(usersTable)
    .where(eq(usersTable.clerkId, targetId));

  // A block reads as "not found" here as it does everywhere else, so the
  // response never reveals that one exists.
  if (!target || (await isBlockedEitherWay(callerId, targetId))) {
    return { ok: false, status: 404, error: "User not found." };
  }

  if (callerId === targetId || !target.isPrivate) return { ok: true };

  const [edge] = await db
    .select({ id: followsTable.id })
    .from(followsTable)
    .where(
      and(
        eq(followsTable.followerId, callerId),
        eq(followsTable.followeeId, targetId),
        eq(followsTable.status, "accepted")
      )
    );

  return edge
    ? { ok: true }
    : { ok: false, status: 403, error: "This account is private." };
}

const FOLLOW_LIST_COLUMNS = {
  clerkId: usersTable.clerkId,
  username: usersTable.username,
  displayInitials: usersTable.displayInitials,
  isPrivate: usersTable.isPrivate,
  avatarUrl: usersTable.avatarUrl,
};

router.get("/users/:id/followers", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const targetId = String(req.params.id ?? "").trim();

  const access = await resolveListAccess(clerkUserId, targetId);
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  const users = await db
    .select(FOLLOW_LIST_COLUMNS)
    .from(followsTable)
    .innerJoin(usersTable, eq(followsTable.followerId, usersTable.clerkId))
    .where(and(eq(followsTable.followeeId, targetId), eq(followsTable.status, "accepted")))
    .orderBy(desc(followsTable.createdAt));

  res.json({ users });
});

router.get("/users/:id/following", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const targetId = String(req.params.id ?? "").trim();

  const access = await resolveListAccess(clerkUserId, targetId);
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  const users = await db
    .select(FOLLOW_LIST_COLUMNS)
    .from(followsTable)
    .innerJoin(usersTable, eq(followsTable.followeeId, usersTable.clerkId))
    .where(and(eq(followsTable.followerId, targetId), eq(followsTable.status, "accepted")))
    .orderBy(desc(followsTable.createdAt));

  res.json({ users });
});

router.get("/users/:id/watched", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const targetId = String(req.params.id ?? "").trim();
  if (!targetId) {
    res.status(400).json({ error: "id path param is required" });
    return;
  }

  if (targetId !== clerkUserId) {
    // Blocking already deletes the follow rows in both directions (see
    // POST /blocks), so the mutual-follow gate below would fail anyway —
    // but stated explicitly so this route doesn't silently depend on that
    // side effect surviving future changes to what blocking does.
    if (await isBlockedEitherWay(clerkUserId, targetId)) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const [theyFollowMe, iFollowThem] = await Promise.all([
      db
        .select({ id: followsTable.id })
        .from(followsTable)
        .where(and(eq(followsTable.followerId, targetId), eq(followsTable.followeeId, clerkUserId), eq(followsTable.status, "accepted"))),
      db
        .select({ id: followsTable.id })
        .from(followsTable)
        .where(and(eq(followsTable.followerId, clerkUserId), eq(followsTable.followeeId, targetId), eq(followsTable.status, "accepted"))),
    ]);

    if (theyFollowMe.length === 0 || iFollowThem.length === 0) {
      res.status(403).json({ error: "You can only see watched films for accounts that follow each other." });
      return;
    }
  }

  const movies = await db
    .select()
    .from(moviesTable)
    .where(and(eq(moviesTable.clerkUserId, targetId), eq(moviesTable.isWatched, true)))
    .orderBy(desc(moviesTable.watchedAt));

  res.json(ListMoviesResponse.parse({ movies }));
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
