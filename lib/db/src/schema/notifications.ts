import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const filmNotificationsTable = pgTable("film_notifications", {
  id: serial("id").primaryKey(),
  fromUserId: text("from_user_id").notNull(), // Clerk user ID of sender
  toUserId: text("to_user_id").notNull(),     // Clerk user ID of recipient
  tmdbId: integer("tmdb_id").notNull(),
  filmTitle: text("film_title").notNull(),
  posterUrl: text("poster_url").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  reaction: text("reaction"), // emoji or "Watched it!" — set by recipient
  reactedAt: timestamp("reacted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FilmNotification = typeof filmNotificationsTable.$inferSelect;
