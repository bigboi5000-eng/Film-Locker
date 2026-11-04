-- Per-category push preferences.
--
-- Defaulting to true matters: every existing row predates the setting, and
-- an account that silently stopped receiving anything the day this shipped
-- would read as the notifications being broken rather than as a new choice
-- nobody had made yet.
--
-- IF NOT EXISTS and a breakpoint between each one, because the migrator is
-- reconciling: it runs every statement inside its own savepoint so a
-- duplicate can be tolerated rather than failing the batch, and that only
-- works per statement. See src/migrate.ts.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notify_recommendations" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notify_messages" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notify_pals" boolean DEFAULT true NOT NULL;
