CREATE TABLE IF NOT EXISTS "movies" (
	"id" serial PRIMARY KEY NOT NULL,
	"tmdb_id" integer NOT NULL,
	"title" text NOT NULL,
	"release_year" text NOT NULL,
	"poster_url" text NOT NULL,
	"overview" text DEFAULT '' NOT NULL,
	"director" text DEFAULT '' NOT NULL,
	"cast" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"genres" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"language" text DEFAULT '' NOT NULL,
	"watch_providers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"clerk_user_id" text DEFAULT '' NOT NULL,
	"rating" integer,
	"is_watched" boolean DEFAULT false NOT NULL,
	"watched_at" timestamp with time zone,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_id" text NOT NULL,
	"username" text,
	"email" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "film_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tmdb_id" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "film_community_ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tmdb_id" integer NOT NULL,
	"rating" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "movies_tmdb_user_unique" ON "movies" USING btree ("tmdb_id","clerk_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "community_ratings_user_tmdb_unique" ON "film_community_ratings" USING btree ("user_id","tmdb_id");
