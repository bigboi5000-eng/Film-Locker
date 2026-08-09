CREATE TABLE IF NOT EXISTS "film_notifications" (
"id" serial PRIMARY KEY NOT NULL,
"from_user_id" text NOT NULL,
"to_user_id" text NOT NULL,
"tmdb_id" integer NOT NULL,
"film_title" text NOT NULL,
"poster_url" text NOT NULL,
"is_read" boolean DEFAULT false NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
