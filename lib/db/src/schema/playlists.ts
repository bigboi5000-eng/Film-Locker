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
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniquePlaylistFilm: unique().on(t.playlistId, t.tmdbId),
  })
);
