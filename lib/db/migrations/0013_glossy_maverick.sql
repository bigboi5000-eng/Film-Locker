-- Half-star ratings, and somewhere to keep TMDB's own score.
--
-- The type change is lossless and needs no backfill: an integer 4 becomes
-- a real 4, which is still four stars, and halves can be stored from here
-- on. Real rather than numeric because node-postgres returns numeric as a
-- string to preserve precision that half-stars do not have — every value
-- this column will hold is exact in binary floating point.
--
-- Both statements are re-runnable, which this repo's migrator requires (see
-- lib/db/src/migrate.ts): changing a column to the type it already has is a
-- no-op, and a replayed ADD COLUMN finds the column present and is skipped.
--
-- tmdb_rating starts null everywhere and fills in as films are enriched.
-- Nothing backfills it here: it would mean a TMDB request per row inside a
-- migration that blocks the container from starting.
ALTER TABLE "movies" ALTER COLUMN "rating" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "tmdb_rating" real;
