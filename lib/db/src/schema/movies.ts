import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  uniqueIndex,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface WatchProvider {
  provider_id: number;
  provider_name: string;
  logo_url: string;
  /** Whether the title is included in a subscription, or available to rent/buy */
  type: 'flatrate' | 'rent' | 'buy';
  /** JustWatch deep-link for this film (same URL for all providers of the same title) */
  link?: string;
}

export const moviesTable = pgTable(
  "movies",
  {
    id: serial("id").primaryKey(),
    tmdbId: integer("tmdb_id").notNull(),
    title: text("title").notNull(),
    releaseYear: text("release_year").notNull(),
    posterUrl: text("poster_url").notNull(),
    overview: text("overview").notNull().default(""),
    // Enrichment fields (populated via TMDB credits + watch/providers)
    director: text("director").notNull().default(""),
    cast: text("cast").array().notNull().default(sql`ARRAY[]::text[]`),
    genres: text("genres").array().notNull().default(sql`ARRAY[]::text[]`),
    language: text("language").notNull().default(""),
    watchProviders: jsonb("watch_providers")
      .$type<WatchProvider[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Per-user owner (Clerk user ID)
    clerkUserId: text("clerk_user_id").notNull().default(""),
    // User state
    rating: integer("rating"), // nullable 1–5
    isWatched: boolean("is_watched").notNull().default(false),
    watchedAt: timestamp("watched_at", { withTimezone: true }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("movies_tmdb_user_unique").on(table.tmdbId, table.clerkUserId)],
);

export const insertMovieSchema = createInsertSchema(moviesTable).omit({
  id: true,
  addedAt: true,
});

export type InsertMovie = z.infer<typeof insertMovieSchema>;
export type Movie = typeof moviesTable.$inferSelect;
