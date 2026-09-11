import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// A block is directional (blocker → blocked) but its effects are enforced
// symmetrically everywhere it matters (follows, messaging, comment
// visibility) — see the routes that check it, not this table.
export const blocksTable = pgTable(
  "blocks",
  {
    id: serial("id").primaryKey(),
    blockerId: text("blocker_id").notNull(),
    blockedId: text("blocked_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("blocks_blocker_blocked_unique").on(table.blockerId, table.blockedId),
  ]
);

export type Block = typeof blocksTable.$inferSelect;

// Reports a user, optionally in the context of one specific comment. The
// comment's body/film are snapshotted at report time so the report still
// makes sense even if the comment is later edited or deleted. There's no
// in-app moderation queue yet — reports are emailed to the developer
// best-effort (see lib/email.ts) and this table is the record of truth.
export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  reporterId: text("reporter_id").notNull(),
  reportedUserId: text("reported_user_id").notNull(),
  reason: text("reason").notNull(),
  commentId: integer("comment_id"),
  commentSnapshot: text("comment_snapshot"),
  tmdbId: integer("tmdb_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Report = typeof reportsTable.$inferSelect;
