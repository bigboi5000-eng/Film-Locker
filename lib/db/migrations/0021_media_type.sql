-- Tell a film from a TV series.
--
-- TMDB numbers films and series in SEPARATE sequences, so movie 1399 and
-- series 1399 are different titles. Every table below keys on a bare
-- tmdb_id, which was safe only while the app held films alone: add series
-- without a discriminator and a comment on a show lands under an unrelated
-- film, two people's ratings merge, and a playlist refuses the series
-- because "that id is already in it".
--
-- Defaulted to 'movie' because everything stored so far is one. That makes
-- the column safe to add to live tables with rows in them, and makes the
-- old unique indexes a strict subset of the new ones.
--
-- IF NOT EXISTS / IF EXISTS throughout, and a breakpoint between every
-- statement, because the migrator is reconciling and runs each statement in
-- its own savepoint.

ALTER TABLE "movies" ADD COLUMN IF NOT EXISTS "media_type" text DEFAULT 'movie' NOT NULL;
--> statement-breakpoint
ALTER TABLE "film_community_ratings" ADD COLUMN IF NOT EXISTS "media_type" text DEFAULT 'movie' NOT NULL;
--> statement-breakpoint
ALTER TABLE "film_comments" ADD COLUMN IF NOT EXISTS "media_type" text DEFAULT 'movie' NOT NULL;
--> statement-breakpoint
ALTER TABLE "film_notifications" ADD COLUMN IF NOT EXISTS "media_type" text DEFAULT 'movie' NOT NULL;
--> statement-breakpoint
ALTER TABLE "playlist_items" ADD COLUMN IF NOT EXISTS "media_type" text DEFAULT 'movie' NOT NULL;
--> statement-breakpoint

-- The uniqueness rules, widened to include it.
--
-- Dropped and recreated rather than altered: Postgres has no ALTER INDEX
-- that adds a column. The drop is safe because the replacement is created
-- in the same migration, and the old rule is implied by the new one for
-- every row that exists (all of them 'movie').
DROP INDEX IF EXISTS "movies_tmdb_user_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "movies_tmdb_user_media_unique" ON "movies" ("tmdb_id","clerk_user_id","media_type");
--> statement-breakpoint
DROP INDEX IF EXISTS "community_ratings_user_tmdb_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "community_ratings_user_tmdb_media_unique" ON "film_community_ratings" ("user_id","tmdb_id","media_type");
--> statement-breakpoint

-- playlist_items' uniqueness is a CONSTRAINT rather than a bare index
-- (drizzle's unique().on(...)), so it is dropped as one.
ALTER TABLE "playlist_items" DROP CONSTRAINT IF EXISTS "playlist_items_playlist_id_tmdb_id_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "playlist_items_playlist_tmdb_media_unique" ON "playlist_items" ("playlist_id","tmdb_id","media_type");
