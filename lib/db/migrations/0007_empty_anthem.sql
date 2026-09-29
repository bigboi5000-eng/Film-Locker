CREATE TABLE "blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"blocker_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"reporter_id" text NOT NULL,
	"reported_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"comment_id" integer,
	"comment_snapshot" text,
	"tmdb_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "blocks_blocker_blocked_unique" ON "blocks" USING btree ("blocker_id","blocked_id");