import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";

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
});

export type User = typeof usersTable.$inferSelect;
