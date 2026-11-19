import {
  pgTable,
  real,
  text,
  serial,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const filmCommunityRatingsTable = pgTable(
  "film_community_ratings",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(), // Clerk user ID
    tmdbId: integer("tmdb_id").notNull(),
    // Real, in half-star steps, for the same reason movies.rating is: the
    // stars that write here offer ten positions, not five. This column was
    // left behind when that one was widened in 0013, so a half-star public
    // rating was rejected by the integer check while the identical control
    // one section below accepted it.
    rating: real("rating").notNull(), // 0.5–5, in steps of 0.5
  /**
     * "movie" or "tv".
     *
     * TMDB numbers films and series in separate sequences, so a tmdb_id alone
     * does not identify a title — movie 1399 and series 1399 are different
     * things. Every uniqueness rule that mentions tmdb_id therefore mentions
     * this too.
     *
     * Defaulted to "movie" because every row written before TV existed is
     * one, which is also what makes the column safe to add to live tables.
     */
    mediaType: text("media_type").notNull().default("movie"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("community_ratings_user_tmdb_media_unique").on(
      table.userId,
      table.tmdbId,
      table.mediaType
    ),
  ]
);

export const filmCommentsTable = pgTable("film_comments", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(), // Clerk user ID
  tmdbId: integer("tmdb_id").notNull(),
  body: text("body").notNull(),
  /**
   * "movie" or "tv".
   *
   * TMDB numbers films and series in separate sequences, so a tmdb_id alone
   * does not identify a title — movie 1399 and series 1399 are different
   * things. Every uniqueness rule that mentions tmdb_id therefore mentions
   * this too.
   *
   * Defaulted to "movie" because every row written before TV existed is
   * one, which is also what makes the column safe to add to live tables.
   */
  mediaType: text("media_type").notNull().default("movie"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type FilmCommunityRating =
  typeof filmCommunityRatingsTable.$inferSelect;
export type FilmComment = typeof filmCommentsTable.$inferSelect;
