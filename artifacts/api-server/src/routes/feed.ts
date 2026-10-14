/**
 * The social feed: what the people you follow have been doing to films.
 *
 * Three sources rather than an activity table, because every one of them
 * already exists with a timestamp on it — somebody marking a film watched,
 * rating it, or writing about it. Nothing is recorded twice, and nothing can
 * drift out of step with the thing it describes. If this ever outgrows the
 * union (it will not at the size of a feed of people you actually follow),
 * a denormalised activity table is the next step, not a first one.
 *
 * Two privacy bars, both inherited rather than invented here:
 *
 *  - ratings, reviews and public playlists go to anyone with an accepted
 *    follow, which is the bar those already use elsewhere;
 *  - watched films need a MUTUAL accepted follow, matching
 *    GET /users/:id/watched, so following somebody one way shows what they
 *    say about films but not what they have been seeing.
 */
import { Router, type IRouter } from "express";
import { and, eq, desc, inArray, sql, count } from "drizzle-orm";
import {
  db,
  usersTable,
  moviesTable,
  followsTable,
  filmCommentsTable,
  filmCommunityRatingsTable,
  playlistsTable,
  playlistItemsTable,
} from "@workspace/db";
import { GetFeedResponse, MarkFeedSeenBody } from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { getMutualBlockSet } from "../lib/blocks";
import { resolveFilmCards } from "../lib/filmCards";

const router: IRouter = Router();

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

/**
 * Pulled per source before merging.
 *
 * Each source is fetched at the page limit rather than a share of it: one
 * prolific friend must not be able to crowd the others out, but nor should a
 * page be short because the quota for a source went unused.
 */
function parseLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
}

interface Actor {
  clerkId: string;
  username: string | null;
  displayInitials: string | null;
  avatarUrl: string | null;
}

router.get("/feed", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;
  const limit = parseLimit(req.query.limit);

  const [me] = await db
    .select({ feedLastSeenAt: usersTable.feedLastSeenAt })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkUserId));

  // Someone whose row has not been provisioned yet has nothing to show and
  // no watermark to compare against; an empty feed is the honest answer.
  if (!me) {
    res.json(GetFeedResponse.parse({ items: [], newCount: 0 }));
    return;
  }

  const [blocked, followRows, followerRows] = await Promise.all([
    getMutualBlockSet(clerkUserId),
    db
      .select({ clerkId: followsTable.followeeId })
      .from(followsTable)
      .where(and(eq(followsTable.followerId, clerkUserId), eq(followsTable.status, "accepted"))),
    db
      .select({ clerkId: followsTable.followerId })
      .from(followsTable)
      .where(and(eq(followsTable.followeeId, clerkUserId), eq(followsTable.status, "accepted"))),
  ]);

  const following = followRows.map((r) => r.clerkId).filter((id) => !blocked.has(id));
  const followsMe = new Set(followerRows.map((r) => r.clerkId));
  // Film Pals — the only people whose watched films the caller may see.
  const mutual = following.filter((id) => followsMe.has(id));

  if (following.length === 0) {
    res.json(GetFeedResponse.parse({ items: [], newCount: 0 }));
    return;
  }

  const [watchedRows, ratingRows, commentRows, playlistRows, actorRows] = await Promise.all([
    mutual.length
      ? db
          .select({
            id: moviesTable.id,
            userId: moviesTable.clerkUserId,
            tmdbId: moviesTable.tmdbId,
            title: moviesTable.title,
            posterUrl: moviesTable.posterUrl,
            releaseYear: moviesTable.releaseYear,
            rating: moviesTable.rating,
            // Nulls sort first on a descending order in Postgres, and
            // watched_at is null on rows marked watched before that column
            // existed — so the plain column would float the oldest entries
            // in somebody's library to the top of a feed.
            at: sql<Date>`coalesce(${moviesTable.watchedAt}, ${moviesTable.addedAt})`.as("at"),
          })
          .from(moviesTable)
          .where(and(inArray(moviesTable.clerkUserId, mutual), eq(moviesTable.isWatched, true)))
          .orderBy(desc(sql`coalesce(${moviesTable.watchedAt}, ${moviesTable.addedAt})`))
          .limit(limit)
      : Promise.resolve([]),

    db
      .select({
        id: filmCommunityRatingsTable.id,
        userId: filmCommunityRatingsTable.userId,
        tmdbId: filmCommunityRatingsTable.tmdbId,
        rating: filmCommunityRatingsTable.rating,
        at: filmCommunityRatingsTable.createdAt,
      })
      .from(filmCommunityRatingsTable)
      .where(inArray(filmCommunityRatingsTable.userId, following))
      .orderBy(desc(filmCommunityRatingsTable.createdAt))
      .limit(limit),

    db
      .select({
        id: filmCommentsTable.id,
        userId: filmCommentsTable.userId,
        tmdbId: filmCommentsTable.tmdbId,
        body: filmCommentsTable.body,
        at: filmCommentsTable.createdAt,
      })
      .from(filmCommentsTable)
      .where(inArray(filmCommentsTable.userId, following))
      .orderBy(desc(filmCommentsTable.createdAt))
      .limit(limit),

    // Public playlists only, and only ones with something in them: an empty
    // playlist somebody made and has not filled is not news, and it would
    // arrive as a card with four blank covers.
    db
      .select({
        id: playlistsTable.id,
        userId: playlistsTable.userId,
        name: playlistsTable.name,
        at: playlistsTable.createdAt,
        itemCount: count(playlistItemsTable.id),
        posters: sql<string[]>`
          array_agg(${playlistItemsTable.posterUrl} ORDER BY ${playlistItemsTable.addedAt} DESC)
          FILTER (WHERE ${playlistItemsTable.id} IS NOT NULL)
        `.as("posters"),
      })
      .from(playlistsTable)
      .innerJoin(playlistItemsTable, eq(playlistItemsTable.playlistId, playlistsTable.id))
      .where(and(inArray(playlistsTable.userId, following), eq(playlistsTable.isPublic, true)))
      .groupBy(playlistsTable.id)
      .orderBy(desc(playlistsTable.createdAt))
      .limit(limit),

    db
      .select({
        clerkId: usersTable.clerkId,
        username: usersTable.username,
        displayInitials: usersTable.displayInitials,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(usersTable)
      .where(inArray(usersTable.clerkId, following)),
  ]);

  const actors = new Map<string, Actor>(actorRows.map((a) => [a.clerkId, a]));

  // Ratings and comments keep a TMDB id and nothing else, so one resolve
  // covers both. Watched rows carry their own metadata already.
  const cards = await resolveFilmCards([
    ...ratingRows.map((r) => r.tmdbId),
    ...commentRows.map((c) => c.tmdbId),
  ]);

  const seenBefore = me.feedLastSeenAt;

  interface Item {
    id: string;
    type: "watched" | "rated" | "commented" | "playlist";
    at: Date;
    isNew: boolean;
    user: Actor;
    tmdbId: number | null;
    title: string | null;
    posterUrl: string | null;
    releaseYear: string | null;
    rating: number | null;
    comment: string | null;
    playlistId: number | null;
    playlistName: string | null;
    playlistItemCount: number | null;
    playlistPosters: string[] | null;
  }

  const items: Item[] = [];

  const add = (
    partial: Omit<Item, "isNew" | "user"> & { userId: string }
  ) => {
    const user = actors.get(partial.userId);
    // An actor with no users row is an account mid-deletion. Dropping the
    // item is better than a feed card attributed to nobody.
    if (!user) return;
    const { userId: _userId, ...rest } = partial;
    items.push({ ...rest, isNew: rest.at > seenBefore, user });
  };

  for (const w of watchedRows) {
    add({
      id: `watched-${w.id}`,
      type: "watched",
      at: new Date(w.at),
      userId: w.userId,
      tmdbId: w.tmdbId,
      title: w.title,
      posterUrl: w.posterUrl || null,
      releaseYear: w.releaseYear || null,
      rating: w.rating,
      comment: null,
      playlistId: null,
      playlistName: null,
      playlistItemCount: null,
      playlistPosters: null,
    });
  }

  for (const r of ratingRows) {
    add({
      id: `rated-${r.id}`,
      type: "rated",
      at: r.at,
      userId: r.userId,
      tmdbId: r.tmdbId,
      title: cards.get(r.tmdbId)?.title ?? null,
      posterUrl: cards.get(r.tmdbId)?.posterUrl ?? null,
      releaseYear: cards.get(r.tmdbId)?.releaseYear ?? null,
      rating: r.rating,
      comment: null,
      playlistId: null,
      playlistName: null,
      playlistItemCount: null,
      playlistPosters: null,
    });
  }

  for (const c of commentRows) {
    add({
      id: `commented-${c.id}`,
      type: "commented",
      at: c.at,
      userId: c.userId,
      tmdbId: c.tmdbId,
      title: cards.get(c.tmdbId)?.title ?? null,
      posterUrl: cards.get(c.tmdbId)?.posterUrl ?? null,
      releaseYear: cards.get(c.tmdbId)?.releaseYear ?? null,
      rating: null,
      comment: c.body,
      playlistId: null,
      playlistName: null,
      playlistItemCount: null,
      playlistPosters: null,
    });
  }

  for (const pl of playlistRows) {
    add({
      id: `playlist-${pl.id}`,
      type: "playlist",
      at: pl.at,
      userId: pl.userId,
      tmdbId: null,
      title: null,
      posterUrl: null,
      releaseYear: null,
      rating: null,
      comment: null,
      playlistId: pl.id,
      playlistName: pl.name,
      playlistItemCount: Number(pl.itemCount),
      playlistPosters: (pl.posters ?? []).slice(0, 4),
    });
  }

  /**
   * Unseen first, each group newest first.
   *
   * Strict chronological order buries the point of opening the feed: the
   * thing that happened while you were away sits below everything you
   * already read, and on a quiet week it is the only thing you came for.
   * Within each group the order is the ordinary one, so the feed still
   * reads as a timeline rather than a shuffled pile.
   */
  items.sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    return b.at.getTime() - a.at.getTime();
  });

  /**
   * One card per person per film.
   *
   * Rating a film and marking it watched are two rows in two tables, and
   * doing both — which is the normal way round, since the rating control
   * sits on the film's own screen — otherwise produces two cards side by
   * side saying nearly the same thing. Deduped after the sort, so the
   * survivor is whichever action was more recent, or the unseen one where
   * only one of the two is new.
   */
  const seenPairs = new Set<string>();
  const deduped = items.filter((item) => {
    // Playlists are not about one film and have no pair to collapse — two
    // of them from the same person would otherwise fold into one.
    if (item.tmdbId == null) return true;
    const key = `${item.user.clerkId}:${item.tmdbId}`;
    if (seenPairs.has(key)) return false;
    seenPairs.add(key);
    return true;
  });

  const page = deduped.slice(0, limit);

  res.json(
    GetFeedResponse.parse({
      items: page,
      newCount: page.filter((i) => i.isNew).length,
    })
  );
});

// ── POST /feed/seen ──────────────────────────────────────────────────────────

router.post("/feed/seen", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  const body = MarkFeedSeenBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const at = body.data.at;

  /**
   * Forwards only, and never past the present.
   *
   * greatest() against the stored value makes the call idempotent and
   * order-independent, which matters because two devices can report
   * different high-water marks seconds apart and the later request is not
   * necessarily the further one. Clamped to now() so a device with a fast
   * clock cannot mark future activity as already seen.
   */
  await db
    .update(usersTable)
    .set({
      feedLastSeenAt: sql`least(greatest(${usersTable.feedLastSeenAt}, ${at.toISOString()}::timestamptz), now())`,
    })
    .where(eq(usersTable.clerkId, clerkUserId));

  res.status(204).send();
});

export default router;
