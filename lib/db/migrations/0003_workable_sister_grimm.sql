CREATE TABLE IF NOT EXISTS "follows" (
"id" serial PRIMARY KEY NOT NULL,
"follower_id" text NOT NULL,
"followee_id" text NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "follows_follower_followee_unique" ON "follows" USING btree ("follower_id","followee_id");
