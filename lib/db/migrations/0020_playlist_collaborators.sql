-- Collaborators on a playlist.
--
-- IF NOT EXISTS throughout, and a breakpoint between each statement, because
-- the migrator is reconciling and runs every statement in its own savepoint
-- so a duplicate can be tolerated rather than failing the batch.
CREATE TABLE IF NOT EXISTS "playlist_collaborators" (
  "id" serial PRIMARY KEY NOT NULL,
  "playlist_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "invited_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playlist_collaborators"
  ADD CONSTRAINT "playlist_collaborators_playlist_id_playlists_id_fk"
  FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "playlist_collaborators"
  ADD CONSTRAINT "playlist_collaborators_playlist_id_user_id_unique"
  UNIQUE("playlist_id","user_id");
