import { pgTable, text, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const moviesTable = pgTable(
  "movies",
  {
    id: serial("id").primaryKey(),
    tmdbId: integer("tmdb_id").notNull(),
    title: text("title").notNull(),
    releaseYear: text("release_year").notNull(),
    posterUrl: text("poster_url").notNull(),
    overview: text("overview").notNull().default(""),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("movies_tmdb_id_unique").on(table.tmdbId)],
);

export const insertMovieSchema = createInsertSchema(moviesTable).omit({
  id: true,
  addedAt: true,
});

export type InsertMovie = z.infer<typeof insertMovieSchema>;
export type Movie = typeof moviesTable.$inferSelect;
