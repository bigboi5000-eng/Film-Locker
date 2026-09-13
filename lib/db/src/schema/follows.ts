import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const followsTable = pgTable(
  "follows",
  {
    id: serial("id").primaryKey(),
    followerId: text("follower_id").notNull(), // Clerk user ID of the person following
    followeeId: text("followee_id").notNull(), // Clerk user ID of the person being followed
    // "accepted" immediately for public followees; "pending" for private ones
    // until the followee approves it via PATCH /follows/:userId/accept.
    status: text("status").notNull().default("accepted"), // "pending" | "accepted"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("follows_follower_followee_unique").on(table.followerId, table.followeeId),
  ]
);

export type Follow = typeof followsTable.$inferSelect;
