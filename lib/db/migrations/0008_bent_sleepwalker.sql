CREATE TABLE "playlist_follows" (
	"id" serial PRIMARY KEY NOT NULL,
	"playlist_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playlist_follows_playlist_id_user_id_unique" UNIQUE("playlist_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "playlist_follows" ADD CONSTRAINT "playlist_follows_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;