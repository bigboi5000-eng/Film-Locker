/**
 * Runs the real identification pipeline against one URL and prints what each
 * stage did, without saving anything.
 *
 * Sharing a link in the app works too, but this is faster to repeat, does
 * not add films to anyone's watchlist, and puts the per-stage timings and
 * the final source in front of you instead of interleaved through the
 * service log.
 *
 * Run it on the deployed container — the whole question is what that IP can
 * reach:
 *
 *   node dist/scripts/try-social-link.mjs "https://www.instagram.com/reel/XXXX/"
 */
import { processSocialLink } from "../lib/processSocialLink";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node dist/scripts/try-social-link.mjs "<url>"');
    process.exit(1);
  }

  const startedAt = Date.now();

  const result = await processSocialLink(
    url,
    (data, msg) => console.log(`  ${msg}`, JSON.stringify(data)),
    true, // dryRun — identify only, save nothing
    ""
  );

  console.log(`\n${"─".repeat(60)}`);
  console.log(`source   ${result.source}`);
  console.log(`matches  ${result.matches.length}`);
  console.log(`list     ${result.listTitle ?? "(none)"}`);
  console.log(`took     ${Date.now() - startedAt}ms\n`);

  for (const m of result.matches) {
    console.log(`  ${m.movie_title} (${m.release_year || "year unknown"})  confidence ${m.confidence_score}  tmdb ${m.tmdb_id ?? "no match"}`);
  }

  if (result.matches.length === 0) {
    console.log("  Nothing identified. Every route came back empty.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
