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
  reaction: text("reaction"), // deprecated — superseded by conversationMessagesTable, kept for old rows
  reactedAt: timestamp("reacted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FilmNotification = typeof filmNotificationsTable.$inferSelect;

// A growing chat-style feed of reactions/messages between two users. Each row
// is either a reply to a specific film recommendation (replyToNotificationId
// set — via the per-film React button or swipe-to-reply) or a standalone
// message sent independently of any recommendation. Content is restricted to
// a fixed vocabulary at the API layer (see ReactToNotificationBody's enum in
// openapi.yaml) — there is no freeform messaging in this app.
export const conversationMessagesTable = pgTable("conversation_messages", {
  id: serial("id").primaryKey(),
  fromUserId: text("from_user_id").notNull(),
  toUserId: text("to_user_id").notNull(),
  content: text("content").notNull(),
  // Mirrors film_notifications.is_read. Without it a reaction could never
  // be unread, so the inbox badge counted recommendations only: a Film Pal
  // replying to a film you sent them lit nothing up anywhere in the app.
  // Existing rows default to read — treating every message ever sent as new
  // would greet people with a badge in the dozens on first launch.
  isRead: boolean("is_read").notNull().default(false),
  replyToNotificationId: integer("reply_to_notification_id").references(
    () => filmNotificationsTable.id,
    { onDelete: "set null" }
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ConversationMessage = typeof conversationMessagesTable.$inferSelect;
