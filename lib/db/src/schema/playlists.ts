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
