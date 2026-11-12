import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, ilike, desc, count, sql, or, isNull, inArray } from "drizzle-orm";
import { db, playlistsTable, playlistItemsTable, playlistFollowsTable, playlistSharesTable, playlistCollaboratorsTable, usersTable, followsTable, moviesTable } from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { isBlockedEitherWay } from "../lib/blocks";
import { areFilmPals } from "../lib/filmPals";
import { sendPush } from "../lib/push";
import {
  canEditPlaylist,
  getCollaboratorIds,
  listCollaboratorProfiles,
  type CollaboratorProfile,
  MAX_PLAYLIST_COLLABORATORS,
} from "../lib/playlistCollaborators";
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

/**
 * Hand-written rather than the generated AddPlaylistItemBody, and therefore
 * able to drift from the spec without anything noticing — zod strips what it
 * does not declare, so a field added to the spec and sent by the client is
 * silently dropped here rather than rejected. sourceUrl was exactly that
 * until this line was added. Worth collapsing into the generated schema.
 */
const SharePlaylistBody = z.object({
  toUserIds: z.array(z.string().min(1)).min(1).max(50),
});

const AddCollaboratorBody = z.object({
  userId: z.string().min(1),
});

const AddItemBody = z.object({
  tmdbId: z.number().int(),
  filmTitle: z.string().min(1),
  posterUrl: z.string().min(1),
  sourceUrl: z.string().nullish(),
});

// ── GET /playlists ─────────────────────────────────────────────────────────
// Every playlist the caller can add films TO: their own, and any they have
// been invited to collaborate on.
//
// Collaborations belong here rather than beside the followed lists, because
// what this endpoint is for — and the only reason GET /playlists/followed
// exists separately — is that it must not offer a destination that 403s on
// use. A followed list is read-only; a collaboration is not.
//
// They are flagged, not hidden: the client needs to know whose list it is,
// since the owner keeps renaming, sending and deleting.

router.get("/playlists", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  /**
   * A subquery rather than a join, because this query already left-joins
   * the items table to count them. A second join would fan each playlist
   * out by its number of collaborators and inflate that count.
   */
  const collaboratingOn = db
    .select({ playlistId: playlistCollaboratorsTable.playlistId })
    .from(playlistCollaboratorsTable)
    .where(eq(playlistCollaboratorsTable.userId, clerkUserId));

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
      // Whose list it is, for the ones that are not the caller's. Null for
      // their own, which the client already labels as theirs.
      ownerUsername: usersTable.username,
    })
    .from(playlistsTable)
    .leftJoin(playlistItemsTable, eq(playlistItemsTable.playlistId, playlistsTable.id))
    .leftJoin(usersTable, eq(usersTable.clerkId, playlistsTable.userId))
    .where(
      or(
        eq(playlistsTable.userId, clerkUserId),
        inArray(playlistsTable.id, collaboratingOn)
      )
    )
    .groupBy(playlistsTable.id, usersTable.username)
    .orderBy(desc(playlistsTable.updatedAt));

  res.json({
    playlists: rows.map((r) => {
      const isCollaboration = r.userId !== clerkUserId;
      return {
        ...r,
        coverPosters: (r.coverPosters ?? []).slice(0, 4),
        isCollaboration,
        ownerUsername: isCollaboration ? r.ownerUsername : null,
      };
    }),
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

  /**
   * A list sent straight to this person.
   *
   * The third way through the gates below, and deliberately so: being sent
   * something is the owner saying "you, specifically, should see this", and
   * a send that could not be opened would be no send at all. It covers a
   * private list and a private owner alike, for that one recipient.
   *
   * It does NOT cover a block, which is checked on its own further down and
   * wins over this — having been sent a list before a falling-out does not
   * outlast the falling-out.
   */
  const sharedWithMe =
    clerkUserId !== null &&
    (
      await db
        .select({ id: playlistSharesTable.id })
        .from(playlistSharesTable)
        .where(
          and(
            eq(playlistSharesTable.playlistId, id),
            eq(playlistSharesTable.toUserId, clerkUserId)
          )
        )
        .limit(1)
    ).length > 0;

  /**
   * Who has been invited to edit this list, oldest invite first.
   *
   * Fetched before the visibility gate because being invited is a grant in
   * its own right, exactly like having been sent the list: an invitation to
   * edit something you cannot open is not an invitation. It is also needed
   * further down for the watched badges, so fetching it here costs nothing
   * extra.
   */
  const collaboratorIds = await getCollaboratorIds(id);
  const isCollaborating = clerkUserId !== null && collaboratorIds.includes(clerkUserId);

  if (!isOwner) {
    if (!playlist.isPublic && !sharedWithMe && !isCollaborating) {
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

      if (accepted.length === 0 && !sharedWithMe && !isCollaborating) {
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

  /**
   * The people on the list, and which of them has seen each film.
   *
   * Both are skipped entirely on a solo list. There is nobody to tell apart,
   * and a watchedBy naming only the owner would repeat what the tick on
   * their own poster already says — while costing two queries on every view
   * of every public playlist in the app.
   *
   * The order of `everyone` is the contract the badge colours rest on:
   * owner first, then collaborators by invite date. The client colours by
   * position, so this list must not be re-ordered and a new invitee must
   * land at the end.
   */
  let collaborators: CollaboratorProfile[] | undefined;
  let watchedBy: Map<number, string[]> | undefined;

  if (collaboratorIds.length > 0) {
    const everyone = [playlist.userId, ...collaboratorIds];
    const tmdbIds = items.map((i) => i.tmdbId);

    const [profiles, watchedRows] = await Promise.all([
      listCollaboratorProfiles(id, playlist.userId),
      tmdbIds.length > 0
        ? db
            .select({ tmdbId: moviesTable.tmdbId, clerkUserId: moviesTable.clerkUserId })
            .from(moviesTable)
            .where(
              and(
                inArray(moviesTable.clerkUserId, everyone),
                inArray(moviesTable.tmdbId, tmdbIds),
                eq(moviesTable.isWatched, true)
              )
            )
        : Promise.resolve([] as { tmdbId: number; clerkUserId: string }[]),
    ]);

    collaborators = profiles;

    // Collected into sets first and then emitted in `everyone` order, so
    // the badges on a poster come back in the same order as the avatars at
    // the top of the screen however the rows happened to arrive.
    const seen = new Map<number, Set<string>>();
    for (const r of watchedRows) {
      const set = seen.get(r.tmdbId) ?? new Set<string>();
      set.add(r.clerkUserId);
      seen.set(r.tmdbId, set);
    }
    watchedBy = new Map(
      [...seen.entries()].map(([tmdbId, set]) => [tmdbId, everyone.filter((u) => set.has(u))])
    );
  }

  res.json({
    ...playlist,
    items: watchedBy
      ? items.map((i) => ({ ...i, watchedBy: watchedBy.get(i.tmdbId) ?? [] }))
      : items,
    isOwner,
    isFollowed: followRows.length > 0,
    // Films are the shared part; the list itself is not. A collaborator
    // adds and removes, but renaming, deleting, inviting and sending stay
    // with the owner, which is why the client still needs isOwner.
    canEdit: isOwner || isCollaborating,
    ...(collaborators
      ? { collaborators, maxCollaborators: MAX_PLAYLIST_COLLABORATORS }
      : {}),
  });
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

// ── Collaborators ─────────────────────────────────────────────────────────
//
// Editing somebody else's playlist, which is a narrower grant than it looks:
// a collaborator adds and removes FILMS. The list itself — its name, its
// privacy, who else is on it, whether it exists — stays with the owner.
//
// There is no pending/accept step. A collaborator must already be a Film
// Pal, which is two accepted follows and a relationship both people opted
// into, and anyone added can remove themselves at any time. Asking for a
// second yes to the same question would only mean lists sitting unusable
// in an invite queue.

/**
 * GET /playlists/:id/collaborators
 *
 * Owner and collaborators only. This is the management view — who is on the
 * list, so somebody can be removed, and how many seats are left. A plain
 * viewer of a public list gets the same people, with no seat count, inlined
 * in GET /playlists/:id, which is all they need to read the badges.
 */
router.get("/playlists/:id/collaborators", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [playlist] = await db
    .select({ userId: playlistsTable.userId })
    .from(playlistsTable)
    .where(eq(playlistsTable.id, id));

  if (!playlist) { res.status(404).json({ error: "Playlist not found" }); return; }
  if (!(await canEditPlaylist(id, playlist.userId, clerkUserId))) {
    res.status(403).json({ error: "Not your playlist" });
    return;
  }

  res.json({
    collaborators: await listCollaboratorProfiles(id, playlist.userId),
    maxCollaborators: MAX_PLAYLIST_COLLABORATORS,
  });
});

/**
 * POST /playlists/:id/collaborators
 *
 * Owner invites one Film Pal.
 *
 * Also sends them the list, by writing the same playlist_shares row that
 * POST /playlists/:id/share writes. Without it the invitation would be
 * invisible: nothing in their inbox, and a private list would not even
 * appear in a search. The share row and the collaborator row answer
 * different questions — "did somebody put this in front of me" and "may I
 * change it" — and an invite is both.
 */
router.post("/playlists/:id/collaborators", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = AddCollaboratorBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { userId } = parsed.data;

  const [playlist] = await db
    .select({ userId: playlistsTable.userId, name: playlistsTable.name })
    .from(playlistsTable)
    .where(eq(playlistsTable.id, id));

  if (!playlist) { res.status(404).json({ error: "Playlist not found" }); return; }
  if (playlist.userId !== clerkUserId) {
    res.status(403).json({ error: "Only the owner can invite people to a playlist." });
    return;
  }
  if (userId === clerkUserId) {
    res.status(400).json({ error: "It is already your playlist." });
    return;
  }
  if (!(await areFilmPals(clerkUserId, userId))) {
    res.status(400).json({ error: "You can only invite Film Pals to edit a playlist." });
    return;
  }

  /**
   * The seat count and the insert, under a lock on the playlist row.
   *
   * Counting and then inserting without one lets two invites sent at the
   * same moment both see four seats taken and both take the fifth. The lock
   * is on the playlist rather than the collaborator rows because the thing
   * being protected is a count of rows that do not exist yet, which no row
   * lock on that table can cover.
   */
  const outcome = await db.transaction(async (tx) => {
    await tx.select({ id: playlistsTable.id }).from(playlistsTable).where(eq(playlistsTable.id, id)).for("update");

    const existing = await tx
      .select({ userId: playlistCollaboratorsTable.userId })
      .from(playlistCollaboratorsTable)
      .where(eq(playlistCollaboratorsTable.playlistId, id));

    // Inviting somebody already on the list is a no-op, not an error and
    // not a second seat: the owner tapping twice gets what they wanted.
    if (existing.some((c) => c.userId === userId)) return "already" as const;
    if (existing.length >= MAX_PLAYLIST_COLLABORATORS) return "full" as const;

    await tx
      .insert(playlistCollaboratorsTable)
      .values({ playlistId: id, userId, invitedBy: clerkUserId })
      .onConflictDoNothing();

    return "added" as const;
  });

  if (outcome === "full") {
    res.status(400).json({
      error: `A playlist can have ${MAX_PLAYLIST_COLLABORATORS} collaborators. Remove someone first.`,
    });
    return;
  }

  if (outcome === "added") {
    await db
      .insert(playlistSharesTable)
      .values({ playlistId: id, fromUserId: clerkUserId, toUserId: userId })
      .onConflictDoUpdate({
        target: [playlistSharesTable.playlistId, playlistSharesTable.fromUserId, playlistSharesTable.toUserId],
        set: { createdAt: new Date(), isRead: false },
      });

    await db.update(playlistsTable).set({ updatedAt: new Date() }).where(eq(playlistsTable.id, id));

    const [[invitee], [owner]] = await Promise.all([
      db
        .select({ expoPushToken: usersTable.expoPushToken, notifyPals: usersTable.notifyPals })
        .from(usersTable)
        .where(eq(usersTable.clerkId, userId)),
      db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.clerkId, clerkUserId)),
    ]);

    if (invitee?.notifyPals) {
      void sendPush({
        token: invitee.expoPushToken,
        title: "You can edit a playlist",
        body: `${owner?.username ?? "A Film Pal"} invited you to add films to ${playlist.name}`,
        screen: `/playlist/${id}`,
      });
    }

    req.log.info({ playlistId: id, invited: userId }, "playlist collaborator added");
  }

  res.status(201).json({
    collaborators: await listCollaboratorProfiles(id, playlist.userId),
    maxCollaborators: MAX_PLAYLIST_COLLABORATORS,
  });
});

/**
 * DELETE /playlists/:id/collaborators/:userId
 *
 * The owner removes anyone; anyone removes themselves. Leaving is the
 * other half of there being no accept step: the way out has to be in the
 * invitee's own hands, or an invitation becomes something done TO them.
 *
 * Films the leaver added stay. They were added to somebody else's list,
 * which is what collaborating means, and pulling them back out would turn
 * leaving into a way to gut the list on the way through.
 */
router.delete("/playlists/:id/collaborators/:userId", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const id = Number(req.params.id);
  // String() rather than the raw param: Express types a path param as
  // string | string[], and a clerkId that arrived as an array would reach
  // the query builder as one.
  const userId = Array.isArray(req.params.userId) ? "" : String(req.params.userId ?? "");
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!userId) { res.status(400).json({ error: "Invalid userId" }); return; }

  const [playlist] = await db
    .select({ userId: playlistsTable.userId })
    .from(playlistsTable)
    .where(eq(playlistsTable.id, id));

  if (!playlist) { res.status(404).json({ error: "Playlist not found" }); return; }

  const isOwner = playlist.userId === clerkUserId;
  if (!isOwner && userId !== clerkUserId) {
    res.status(403).json({ error: "Only the owner can remove somebody else." });
    return;
  }

  await db
    .delete(playlistCollaboratorsTable)
    .where(
      and(
        eq(playlistCollaboratorsTable.playlistId, id),
        eq(playlistCollaboratorsTable.userId, userId)
      )
    );

  req.log.info({ playlistId: id, removed: userId, byOwner: isOwner }, "playlist collaborator removed");

  res.json({
    collaborators: await listCollaboratorProfiles(id, playlist.userId),
    maxCollaborators: MAX_PLAYLIST_COLLABORATORS,
  });
});

// ── POST /playlists/:id/items ─────────────────────────────────────────────

router.post("/playlists/:id/items", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = AddItemBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // The owner, or anyone they invited to collaborate.
  const [playlist] = await db
    .select({ userId: playlistsTable.userId })
    .from(playlistsTable)
    .where(eq(playlistsTable.id, id));

  if (!playlist) { res.status(404).json({ error: "Playlist not found" }); return; }
  if (!(await canEditPlaylist(id, playlist.userId, clerkUserId))) {
    res.status(403).json({ error: "Not your playlist" });
    return;
  }

  const [item] = await db
    .insert(playlistItemsTable)
    .values({ playlistId: id, ...parsed.data })
    .onConflictDoNothing()
    .returning();

  // Already in the playlist, so the insert wrote nothing — the source
  // included. Fill it in only where there is not one already, matching how
  // a locker film behaves: the first post a film arrived from is the one
  // worth keeping, and adding the same film again does not rewrite it.
  if (!item && parsed.data.sourceUrl) {
    await db
      .update(playlistItemsTable)
      .set({ sourceUrl: parsed.data.sourceUrl })
      .where(
        and(
          eq(playlistItemsTable.playlistId, id),
          eq(playlistItemsTable.tmdbId, parsed.data.tmdbId),
          isNull(playlistItemsTable.sourceUrl)
        )
      );
  }

  // Bump updatedAt on the playlist
  await db
    .update(playlistsTable)
    .set({ updatedAt: new Date() })
    .where(eq(playlistsTable.id, id));

  res.status(201).json(item ?? { message: "Already in playlist" });
});

// ── POST /playlists/:id/share ─────────────────────────────────────────────
// Send a playlist to one or more people.
//
// Recipients are taken as a list rather than one at a time: picking several
// friends is the normal case, and a request each would mean a half-sent
// list when the third one fails.
//
// Only the owner may send their own list. Sharing somebody else's would let
// a reader hand out access the owner never gave — the row is a grant, and
// only the owner has anything to grant.

router.post("/playlists/:id/share", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = SharePlaylistBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [playlist] = await db
    .select({ userId: playlistsTable.userId, name: playlistsTable.name })
    .from(playlistsTable)
    .where(eq(playlistsTable.id, id));

  if (!playlist) { res.status(404).json({ error: "Playlist not found" }); return; }
  if (playlist.userId !== clerkUserId) {
    res.status(403).json({ error: "You can only send your own playlists." });
    return;
  }

  // Duplicates in, one row out. Sending to yourself is dropped rather than
  // rejected: it is a mis-tap, not an error worth failing the whole send.
  const recipients = [...new Set(parsed.data.toUserIds)].filter((u) => u && u !== clerkUserId);
  if (recipients.length === 0) {
    res.status(400).json({ error: "No one to send it to." });
    return;
  }

  // Blocked people are dropped silently rather than reported, for the same
  // reason a block shows as 404 elsewhere: saying "that person blocked you"
  // discloses the block.
  const allowed: string[] = [];
  for (const to of recipients) {
    if (!(await isBlockedEitherWay(clerkUserId, to))) allowed.push(to);
  }

  if (allowed.length > 0) {
    await db
      .insert(playlistSharesTable)
      .values(allowed.map((to) => ({ playlistId: id, fromUserId: clerkUserId, toUserId: to })))
      // Sending the same list to the same person again is a nudge: the row
      // is dated now and goes unread, rather than becoming a second entry
      // in their inbox or being silently ignored.
      .onConflictDoUpdate({
        target: [playlistSharesTable.playlistId, playlistSharesTable.fromUserId, playlistSharesTable.toUserId],
        set: { createdAt: new Date(), isRead: false },
      });
  }

  await db.update(playlistsTable).set({ updatedAt: new Date() }).where(eq(playlistsTable.id, id));

  req.log.info({ playlistId: id, sent: allowed.length, asked: recipients.length }, "playlist shared");
  // The count is of what was actually sent. A caller that asked for three
  // and is told three can say so; one told two knows something was dropped
  // without being told which or why.
  res.status(201).json({ sent: allowed.length });
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

  // The owner, or anyone they invited to collaborate. A collaborator who
  // can add but not remove cannot plan a watch together — fixing a wrong
  // film would mean asking the owner to do it.
  const [playlist] = await db
    .select({ userId: playlistsTable.userId })
    .from(playlistsTable)
    .where(eq(playlistsTable.id, id));

  if (!playlist || !(await canEditPlaylist(id, playlist.userId, clerkUserId))) {
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
