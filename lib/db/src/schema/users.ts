import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  username: text("username").unique(), // nullable — collected in social phase
  email: text("email").notNull(),
  avatarUrl: text("avatar_url"),
  expoPushToken: text("expo_push_token"), // nullable — set when user grants push permission
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
