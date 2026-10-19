import {
  pgTable,
  text,
  serial,
  integer,
  real,
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
    // Minutes. Nullable rather than defaulted, because "we have not enriched
    // this row yet" and "TMDB has no runtime for this film" both have to be
    // distinguishable from a real length — and 0 is not a real length.
    runtime: integer("runtime"),
    // TMDB's own average, 0-10. Nullable for the same reason as runtime:
    // "not enriched yet" and "TMDB has no score for this film" both have to
    // stay distinguishable from a real one, and 0 is a real one.
    tmdbRating: real("tmdb_rating"),
    // When TMDB was last successfully asked about this film. Distinguishes
    // "we have never asked" from "we asked and TMDB has no score for it",
    // which the nullable enrichment columns cannot do on their own — without
    // it, the backfill would re-fetch every vote-less film on every boot,
    // for ever.
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    watchProviders: jsonb("watch_providers")
      .$type<WatchProvider[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Per-user owner (Clerk user ID)
    clerkUserId: text("clerk_user_id").notNull().default(""),
    // User state
    // The owner's own score, 0.5-5 in half-star steps. Real rather than
    // integer so a half can be stored, and real rather than numeric because
    // node-postgres hands numeric back as a string to preserve precision it
    // does not have — every half-star value is exact in binary floating
    // point, so there is nothing to preserve.
    rating: real("rating"), // nullable 0.5–5, in steps of 0.5
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
