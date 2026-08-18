CREATE TABLE "conversation_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"content" text NOT NULL,
	"reply_to_notification_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playlist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"playlist_id" integer NOT NULL,
	"tmdb_id" integer NOT NULL,
	"film_title" text NOT NULL,
	"poster_url" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playlist_items_playlist_id_tmdb_id_unique" UNIQUE("playlist_id","tmdb_id")
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_initials" text;--> statement-breakpoint
ALTER TABLE "film_notifications" ADD COLUMN "reaction" text;--> statement-breakpoint
ALTER TABLE "film_notifications" ADD COLUMN "reacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_reply_to_notification_id_film_notifications_id_fk" FOREIGN KEY ("reply_to_notification_id") REFERENCES "public"."film_notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;