-- Read state for reactions and canned messages, mirroring
-- film_notifications.is_read.
--
-- Added with a default of TRUE and then switched to FALSE, rather than
-- added as FALSE outright. Every message sent before this column existed
-- is therefore read, and only messages sent from here on can be unread —
-- the alternative greets anyone with a long conversation history with an
-- inbox badge in the dozens for reactions they read months ago.
--
-- Written in two statements so it stays safely re-runnable, which this
-- repo's migrator requires (see lib/db/src/migrate.ts): a replay finds the
-- column already there and skips the ADD, and setting the default again is
-- a no-op. A plain backfill UPDATE would not be — on a replay it would
-- silently mark genuinely unread messages as read.
ALTER TABLE "conversation_messages" ADD COLUMN "is_read" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_messages" ALTER COLUMN "is_read" SET DEFAULT false;
