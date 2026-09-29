import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, ilike, desc, count, sql, or } from "drizzle-orm";
import { db, playlistsTable, playlistItemsTable, playlistFollowsTable, usersTable, followsTable } from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { isBlockedEitherWay } from "../lib/blocks";
import { z } from "zod";

const router: IRouter = Router();

const CreatePlaylistBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(300).optional(),
  isPublic: z.boolean().optional().default(false),
});

const UpdatePlaylistBody = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(300).nullable().optional(),
  isPublic: z.boolean().optional(),
});

const AddItemBody = z.object({
  tmdbId: z.number().int(),
  filmTitle: z.string().min(1),
  posterUrl: z.string().min(1),
});

// ── GET /playlists ─────────────────────────────────────────────────────────
// Returns the authenticated user's own playlists (with item count).

router.get("/playlists", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  const rows = await db
    .select({
      id: playlistsTable.id,
      // The response schema has always declared userId; it just wasn't being
      // selected, so clients typed it as present and got undefined. The
      // ownership checks that hang off it need it for real.
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
    .where(eq(playlistsTable.userId, clerkUserId))
    .groupBy(playlistsTable.id)
    .orderBy(desc(playlistsTable.updatedAt));

  res.json({
    playlists: rows.map((r) => ({
      ...r,
      coverPosters: (r.coverPosters ?? []).slice(0, 4),
    })),
  });
});

// ── GET /playlists/followed ────────────────────────────────────────────────
// Playlists the caller follows but doesn't own. Kept separate from
// GET /playlists deliberately: that list is the set of playlists you can add
// films TO, and a followed playlist is read-only, so mixing them would offer
// destinations that 403 on use.
//
// Defined BEFORE /:id so Express doesn't read "followed" as a playlist id.

router.get("/playlists/followed", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

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
      ownerUsername: usersTable.username,
      ownerDisplayInitials: usersTable.displayInitials,
      ownerAvatarUrl: usersTable.avatarUrl,
    })
    .from(playlistFollowsTable)
    .innerJoin(playlistsTable, eq(playlistsTable.id, playlistFollowsTable.playlistId))
    .innerJoin(usersTable, eq(usersTable.clerkId, playlistsTable.userId))
    .leftJoin(playlistItemsTable, eq(playlistItemsTable.playlistId, playlistsTable.id))
    .where(
      and(
        eq(playlistFollowsTable.userId, clerkUserId),
        // A playlist that has since been made private, or whose owner has
        // gone private and no longer accepts this follower, drops out of the
        // list rather than 403-ing when opened.
        eq(playlistsTable.isPublic, true),
        or(
          eq(usersTable.isPrivate, false),
          sql`EXISTS (
            SELECT 1 FROM ${followsTable}
            WHERE ${followsTable.followerId} = ${clerkUserId}
              AND ${followsTable.followeeId} = ${playlistsTable.userId}
              AND ${followsTable.status} = 'accepted'
          )`
        )
      )
    )
    .groupBy(playlistsTable.id, usersTable.id)
    .orderBy(desc(playlistsTable.updatedAt));

  res.json({
    playlists: rows.map((r) => ({
      ...r,
      coverPosters: (r.coverPosters ?? []).slice(0, 4),
    })),
  });
});

// ── POST /playlists ────────────────────────────────────────────────────────

router.post("/playlists", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const parsed = CreatePlaylistBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [row] = await db
    .insert(playlistsTable)
    .values({
      userId: clerkUserId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      isPublic: parsed.data.isPublic ?? false,
    })
    .returning();

  res.status(201).json({ ...row, itemCount: 0, coverPosters: [] });
});

// ── GET /playlists/public ─────────────────────────────────────────────────
// Search public playlists — by name (q), by a constituent film (tmdbId), or
// scoped to one user's public playlists (userId, used by the profile
// screen). Must be defined BEFORE /:id to avoid Express treating "public"
// as a playlist id.
//
// Unauthenticated requests are allowed (no requireAuth), but a signed-in
// caller's identity (when present) is still used to decide visibility: a
// public playlist owned by a PRIVATE account is only included for the
// owner themselves or an accepted follower — matching how that account's
// comments are already followers-only elsewhere. Per-playlist isPublic and
// the owner's account-level isPrivate are otherwise independent gates.

router.get("/playlists/public", async (req, res): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  const tmdbId = req.query.tmdbId !== undefined ? Number(req.query.tmdbId) : undefined;
  const userId = req.query.userId ? String(req.query.userId).trim() : undefined;
  const viewerId = getAuth(req)?.userId ?? null;

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
      // Owner identity — cheap to include since usersTable is already
      // joined for the privacy check below, and the Discover tab needs to
      // show whose playlist each search result is.
      ownerUsername: usersTable.username,
      ownerDisplayInitials: usersTable.displayInitials,
      ownerAvatarUrl: usersTable.avatarUrl,
    })
    .from(playlistsTable)
    .leftJoin(playlistItemsTable, eq(playlistItemsTable.playlistId, playlistsTable.id))
    .innerJoin(usersTable, eq(usersTable.clerkId, playlistsTable.userId))
    .where(
      and(
        eq(playlistsTable.isPublic, true),
        q.length >= 2 ? ilike(playlistsTable.name, `%${q}%`) : undefined,
        userId ? eq(playlistsTable.userId, userId) : undefined,
        Number.isInteger(tmdbId)
          ? sql`EXISTS (
              SELECT 1 FROM ${playlistItemsTable}
              WHERE ${playlistItemsTable.playlistId} = ${playlistsTable.id}
                AND ${playlistItemsTable.tmdbId} = ${tmdbId}
            )`
          : undefined,
        or(
          eq(usersTable.isPrivate, false),
          viewerId ? eq(playlistsTable.userId, viewerId) : sql`false`,
          viewerId
            ? sql`EXISTS (
                SELECT 1 FROM ${followsTable}
                WHERE ${followsTable.followerId} = ${viewerId}
                  AND ${followsTable.followeeId} = ${playlistsTable.userId}
                  AND ${followsTable.status} = 'accepted'
              )`
            : sql`false`
        )
      )
    )
    // Grouping by usersTable.id (its actual primary key, not just the
    // unique clerkId column) lets Postgres infer the other selected
    // usersTable columns are functionally dependent, without listing each
    // one explicitly.
    .groupBy(playlistsTable.id, usersTable.id)
    .orderBy(desc(playlistsTable.updatedAt))
    .limit(30);

  res.json({
    playlists: rows.map((r) => ({
      ...r,
      coverPosters: (r.coverPosters ?? []).slice(0, 4),
    })),
  });
});

// ── GET /playlists/:id ────────────────────────────────────────────────────
// Returns playlist metadata + all items.
//
// Visibility must match GET /playlists/public exactly, since this endpoint
// returns strictly more than the search list does (every item, not just a
// cover strip) and playlist ids are sequential integers — anything this
// route hands out anonymously is trivially enumerable. Two independent
// gates, same as the search query:
//   1. The playlist itself must be public (or you own it).
//   2. If the OWNER's account is private, only the owner or an accepted
//      follower may see it — a public playlist does not punch a hole
//      through a private account.
// A block in either direction hides it entirely, reported as 404 so the
// block isn't disclosed.

router.get("/playlists/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select({ playlist: playlistsTable, ownerIsPrivate: usersTable.isPrivate })
    .from(playlistsTable)
    .innerJoin(usersTable, eq(usersTable.clerkId, playlistsTable.userId))
    .where(eq(playlistsTable.id, id));

  if (!row) { res.status(404).json({ error: "Playlist not found" }); return; }
  const { playlist, ownerIsPrivate } = row;

  // requireAuth isn't used on this route (public playlists must stay
  // accessible without a token), so read the Clerk session directly —
  // req.auth is a function in @clerk/express (req.auth()), not a plain
  // object; reading req.auth.userId off the function itself always
  // returns undefined, which previously locked owners out of their own
  // private playlists.
  const clerkUserId = getAuth(req)?.userId ?? null;
  const isOwner = clerkUserId !== null && clerkUserId === playlist.userId;

  if (!isOwner) {
    if (!playlist.isPublic) {
      res.status(403).json({ error: "Private playlist" });
      return;
    }

    if (await isBlockedEitherWay(clerkUserId ?? "", playlist.userId)) {
      res.status(404).json({ error: "Playlist not found" });
      return;
    }

    if (ownerIsPrivate) {
      const accepted = clerkUserId
        ? await db
            .select({ id: followsTable.id })
            .from(followsTable)
            .where(
              and(
                eq(followsTable.followerId, clerkUserId),
                eq(followsTable.followeeId, playlist.userId),
                eq(followsTable.status, "accepted")
              )
            )
        : [];

      if (accepted.length === 0) {
        res.status(403).json({ error: "This account is private." });
        return;
      }
    }
  }

  const [items, followRows] = await Promise.all([
    db
      .select()
      .from(playlistItemsTable)
      .where(eq(playlistItemsTable.playlistId, id))
      .orderBy(desc(playlistItemsTable.addedAt)),
    clerkUserId && !isOwner
      ? db
          .select({ id: playlistFollowsTable.id })
          .from(playlistFollowsTable)
          .where(
            and(
              eq(playlistFollowsTable.playlistId, id),
              eq(playlistFollowsTable.userId, clerkUserId)
            )
          )
      : Promise.resolve([]),
  ]);

  res.json({ ...playlist, items, isOwner, isFollowed: followRows.length > 0 });
});

// ── POST /playlists/:id/follow ─────────────────────────────────────────────
// Follow someone else's public playlist. A follow is a reference, not a copy,
// so the follower always sees the owner's current contents.

router.post("/playlists/:id/follow", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select({ userId: playlistsTable.userId, isPublic: playlistsTable.isPublic, ownerIsPrivate: usersTable.isPrivate })
    .from(playlistsTable)
    .innerJoin(usersTable, eq(usersTable.clerkId, playlistsTable.userId))
    .where(eq(playlistsTable.id, id));

  if (!row) { res.status(404).json({ error: "Playlist not found" }); return; }

  if (row.userId === clerkUserId) {
    res.status(400).json({ error: "This is already your playlist." });
    return;
  }
  if (!row.isPublic) {
    res.status(403).json({ error: "Private playlist" });
    return;
  }
  if (await isBlockedEitherWay(clerkUserId, row.userId)) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }
  // Same gate as viewing it: a public playlist owned by a private account is
  // only reachable by an accepted follower, so it can only be followed by one.
  if (row.ownerIsPrivate) {
    const accepted = await db
      .select({ id: followsTable.id })
      .from(followsTable)
      .where(
        and(
          eq(followsTable.followerId, clerkUserId),
          eq(followsTable.followeeId, row.userId),
          eq(followsTable.status, "accepted")
        )
      );
    if (accepted.length === 0) {
      res.status(403).json({ error: "This account is private." });
      return;
    }
  }

  await db
    .insert(playlistFollowsTable)
    .values({ playlistId: id, userId: clerkUserId })
    .onConflictDoNothing();

  res.status(201).json({ playlistId: id, isFollowed: true });
});

// ── DELETE /playlists/:id/follow ───────────────────────────────────────────

router.delete("/playlists/:id/follow", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db
    .delete(playlistFollowsTable)
    .where(
      and(eq(playlistFollowsTable.playlistId, id), eq(playlistFollowsTable.userId, clerkUserId))
    );

  res.status(204).send();
});

// ── PUT /playlists/:id ────────────────────────────────────────────────────

router.put("/playlists/:id", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdatePlaylistBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [updated] = await db
    .update(playlistsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(playlistsTable.id, id), eq(playlistsTable.userId, clerkUserId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Playlist not found or not yours" }); return; }

  res.json(updated);
});

// ── DELETE /playlists/:id ─────────────────────────────────────────────────

router.delete("/playlists/:id", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db
    .delete(playlistsTable)
    .where(and(eq(playlistsTable.id, id), eq(playlistsTable.userId, clerkUserId)));

  res.status(204).send();
});

// ── POST /playlists/:id/items ─────────────────────────────────────────────

router.post("/playlists/:id/items", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = AddItemBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Ownership check
  const [playlist] = await db
    .select({ userId: playlistsTable.userId })
    .from(playlistsTable)
    .where(eq(playlistsTable.id, id));

  if (!playlist) { res.status(404).json({ error: "Playlist not found" }); return; }
  if (playlist.userId !== clerkUserId) { res.status(403).json({ error: "Not your playlist" }); return; }

  const [item] = await db
    .insert(playlistItemsTable)
    .values({ playlistId: id, ...parsed.data })
    .onConflictDoNothing()
    .returning();

  // Bump updatedAt on the playlist
  await db
    .update(playlistsTable)
    .set({ updatedAt: new Date() })
    .where(eq(playlistsTable.id, id));

  res.status(201).json(item ?? { message: "Already in playlist" });
});

// ── DELETE /playlists/:id/items/:tmdbId ──────────────────────────────────

router.delete("/playlists/:id/items/:tmdbId", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const id = Number(req.params.id);
  const tmdbId = Number(req.params.tmdbId);

  if (!Number.isInteger(id) || !Number.isInteger(tmdbId)) {
    res.status(400).json({ error: "Invalid id or tmdbId" });
    return;
  }

  // Ownership check via join
  const [playlist] = await db
    .select({ userId: playlistsTable.userId })
    .from(playlistsTable)
    .where(eq(playlistsTable.id, id));

  if (!playlist || playlist.userId !== clerkUserId) {
    res.status(403).json({ error: "Not your playlist" });
    return;
  }

  await db
    .delete(playlistItemsTable)
    .where(
      and(
        eq(playlistItemsTable.playlistId, id),
        eq(playlistItemsTable.tmdbId, tmdbId)
      )
    );

  res.status(204).send();
});

export default router;
