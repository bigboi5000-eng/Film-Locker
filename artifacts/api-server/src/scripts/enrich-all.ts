/**
 * One-time script: enrich all movies in the DB that have no genres/director data.
 * Run with:  pnpm --filter @workspace/api-server exec tsx src/scripts/enrich-all.ts
 */
import { eq, or, sql } from "drizzle-orm";
import { db, moviesTable } from "@workspace/db";
import { fetchMovieDetails } from "../lib/tmdb";

async function main() {
  // Fetch all movies whose genres array is empty (not yet enriched)
  const movies = await db
    .select()
    .from(moviesTable)
    .where(sql`array_length(${moviesTable.genres}, 1) IS NULL`);

  console.log(`Found ${movies.length} unenriched movie(s). Starting enrichment…`);

  let ok = 0;
  let fail = 0;

  for (const movie of movies) {
    process.stdout.write(`  [${movie.tmdbId}] ${movie.title} … `);
    try {
      const details = await fetchMovieDetails(movie.tmdbId);
      if (!details) {
        console.log("TMDB returned null — skipping");
        fail++;
        continue;
      }
      await db
        .update(moviesTable)
        .set({
          director: details.director,
          cast: details.cast,
          genres: details.genres,
          language: details.language,
          watchProviders: details.watchProviders,
        })
        .where(eq(moviesTable.id, movie.id));
      console.log(`OK (${details.genres.join(", ") || "no genres"})`);
      ok++;
    } catch (err) {
      console.log(`FAILED: ${err}`);
      fail++;
    }

    // Be polite to TMDB — don't hammer the API
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\nDone. ${ok} enriched, ${fail} failed.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
