import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const followsTable = pgTable(
  "follows",
  {
    id: serial("id").primaryKey(),
    followerId: text("follower_id").notNull(), // Clerk user ID of the person following
    followeeId: text("followee_id").notNull(), // Clerk user ID of the person being followed
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("follows_follower_followee_unique").on(table.followerId, table.followeeId),
  ]
);

export type Follow = typeof followsTable.$inferSelect;
