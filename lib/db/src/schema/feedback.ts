import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Source of truth for user feedback — kept even if the notification email
// fails to send (or no email provider is configured), so nothing submitted
// through the app is ever lost.
export const feedbackTable = pgTable("feedback", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(), // Clerk user ID of the submitter
  userEmail: text("user_email").notNull(), // snapshot at submit time
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Feedback = typeof feedbackTable.$inferSelect;
