import { pgTable, serial, text, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  username: text("username").unique(), // nullable — collected in social phase
  displayInitials: text("display_initials"), // nullable — optional 3-char override shown instead of username-derived initials
  email: text("email").notNull(),
  isPrivate: boolean("is_private").notNull().default(false), // private users require accepted follow requests to be followed/messaged; their comments are followers-only
  avatarUrl: text("avatar_url"),
  expoPushToken: text("expo_push_token"), // nullable — set when user grants push permission
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // The .unique() on the column above is case-sensitive, so "JakeT" and
  // "jaket" could both exist — two accounts that read as the same person to
  // everyone looking at them, which is an impersonation route as much as a
  // confusion. This index makes the name unique regardless of case while
  // still storing whatever capitalisation the user chose.
  uniqueIndex("users_username_lower_unique").on(sql`lower(${table.username})`),
]);

export type User = typeof usersTable.$inferSelect;
