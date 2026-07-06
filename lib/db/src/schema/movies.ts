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
    // User state
    rating: integer("rating"), // nullable 1–5
    isWatched: boolean("is_watched").notNull().default(false),
    watchedAt: timestamp("watched_at", { withTimezone: true }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("movies_tmdb_id_unique").on(table.tmdbId)],
);

export const insertMovieSchema = createInsertSchema(moviesTable).omit({
  id: true,
  addedAt: true,
});

export type InsertMovie = z.infer<typeof insertMovieSchema>;
export type Movie = typeof moviesTable.$inferSelect;
