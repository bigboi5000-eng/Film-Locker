ALTER TABLE "users" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "follows" ADD COLUMN "status" text DEFAULT 'accepted' NOT NULL;