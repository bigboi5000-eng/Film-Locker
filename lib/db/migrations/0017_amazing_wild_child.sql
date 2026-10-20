-- Sending a playlist to somebody.
--
-- Distinct from playlist_follows, which is a reader choosing to keep up with
-- a list. This is the owner putting it in front of a person, and it carries
-- the two things a follow does not: who sent it, and whether it has been
-- seen.
--
-- It is also a GRANT, which is the part worth noticing. GET /playlists/:id
-- gates on the playlist being public and on the owner's account not being
-- private; a row here is a third way through both, for one named recipient.
-- That is what sending something to somebody means. A block still wins:
-- having been sent a list before a falling-out does not outlast it.
--
-- The unique constraint makes sending the same list to the same person
-- again a nudge rather than a second entry in their inbox.
--
-- Re-runnable, which this repo's migrator requires (see
-- lib/db/src/migrate.ts): it treats duplicate_table (42P07) and
-- duplicate_object (42710) as "already present" and skips the statement,
-- which covers both of these.
CREATE TABLE "playlist_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"playlist_id" integer NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playlist_shares_playlist_id_from_user_id_to_user_id_unique" UNIQUE("playlist_id","from_user_id","to_user_id")
);
--> statement-breakpoint
ALTER TABLE "playlist_shares" ADD CONSTRAINT "playlist_shares_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;