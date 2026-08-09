import {
  pgTable,
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
    rating: integer("rating").notNull(), // 1–5
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("community_ratings_user_tmdb_unique").on(
      table.userId,
      table.tmdbId
    ),
  ]
);

export const filmCommentsTable = pgTable("film_comments", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(), // Clerk user ID
  tmdbId: integer("tmdb_id").notNull(),
  body: text("body").notNull(),
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
