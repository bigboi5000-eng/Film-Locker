import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const playlistsTable = pgTable("playlists", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(), // clerkUserId of the owner
  name: text("name").notNull(),
  description: text("description"),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Playlists a user follows but does not own.
 *
 * A follow is a reference, not a copy: the follower sees whatever the owner's
 * playlist currently contains, so the owner adding or removing a film is
 * reflected for everyone following it. Cascades on playlist delete, so a
 * deleted playlist takes its follows with it rather than leaving followers
 * pointing at nothing.
 */
export const playlistFollowsTable = pgTable(
  "playlist_follows",
  {
    id: serial("id").primaryKey(),
    playlistId: integer("playlist_id")
      .notNull()
      .references(() => playlistsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(), // clerkUserId of the follower
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueFollow: unique().on(t.playlistId, t.userId),
  })
);

/**
 * A playlist sent to somebody.
 *
 * Separate from playlist_follows, which is a reader choosing to keep up with
 * a list. This is the owner putting it in front of someone, and it carries
 * the two things a follow does not: who sent it, and whether it has been
 * seen.
 *
 * It is also a GRANT. A list you were sent is one you can open, whether or
 * not it is public and whether or not its owner's account is — which is
 * what sending something to somebody means, and is why the visibility gate
 * on GET /playlists/:id consults this table. A block still hides it: being
 * sent a thing before a falling-out does not outlast the falling-out.
 */
export const playlistSharesTable = pgTable(
  "playlist_shares",
  {
    id: serial("id").primaryKey(),
    playlistId: integer("playlist_id")
      .notNull()
      .references(() => playlistsTable.id, { onDelete: "cascade" }),
    fromUserId: text("from_user_id").notNull(),
    toUserId: text("to_user_id").notNull(),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One row per sender/recipient pair. Sending it again is a nudge, not a
    // second entry in their inbox.
    uniqueShare: unique().on(t.playlistId, t.fromUserId, t.toUserId),
  })
);

export type PlaylistShare = typeof playlistSharesTable.$inferSelect;

/**
 * People who can edit somebody else's playlist.
 *
 * Distinct from a follow (keeping up with a list) and from a share
 * (being handed one): a collaborator changes what is in it. The owner
 * stays the owner — only they can invite, remove people, rename or
 * delete the list — but a collaborator can add and remove films, which
 * is the whole point of planning a watch together.
 *
 * No pending state. A collaborator has to be a Film Pal already, which
 * means two accepted follows and a relationship both people opted into,
 * and anyone added can remove themselves. An acceptance step on top of
 * that would be a second yes for the same question.
 */
export const playlistCollaboratorsTable = pgTable(
  "playlist_collaborators",
  {
    id: serial("id").primaryKey(),
    playlistId: integer("playlist_id")
      .notNull()
      .references(() => playlistsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(), // clerkUserId of the collaborator
    invitedBy: text("invited_by").notNull(), // always the owner
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One row per person per list. Inviting someone already on it is a
    // no-op rather than a second seat against the cap.
    uniqueCollaborator: unique().on(t.playlistId, t.userId),
  })
);

export type PlaylistCollaborator = typeof playlistCollaboratorsTable.$inferSelect;

/**
 * How many people can be invited to one playlist, not counting its owner.
 *
 * Here rather than in the route because the cap is a property of the
 * feature, and the client needs the same number to say "3 of 5" without
 * inventing its own.
 */
export const MAX_PLAYLIST_COLLABORATORS = 5;

export const playlistItemsTable = pgTable(
  "playlist_items",
  {
    id: serial("id").primaryKey(),
    playlistId: integer("playlist_id")
      .notNull()
      .references(() => playlistsTable.id, { onDelete: "cascade" }),
    tmdbId: integer("tmdb_id").notNull(),
    filmTitle: text("film_title").notNull(),
    posterUrl: text("poster_url").notNull(),
    // The social post this film was added from, when it was added from one.
    //
    // Kept here as well as on movies.source_url because a film can be put in
    // a playlist WITHOUT being added to the locker, and then there is no
    // movies row to hang it on — which is most of a shared list, since
    // "save these ten films as a playlist" is not the same as "add ten films
    // to my watchlist".
    //
    // Not owner-private the way movies.source_url is: a playlist can be
    // public, and the post a list came from is part of the list rather than
    // part of what one person was reading. Whoever can see the playlist can
    // see where it came from.
    sourceUrl: text("source_url"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniquePlaylistFilm: unique().on(t.playlistId, t.tmdbId),
  })
);
