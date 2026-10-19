/**
 * Manual enrichment backfill.
 *
 * The server does this itself in the background after every boot (see
 * src/index.ts), so this is the hand-crank for running it against a database
 * from a shell — a local one, or production with its DATABASE_URL in the
 * environment — rather than waiting for a deploy.
 *
 * Run with:  pnpm --filter @workspace/api-server exec tsx src/scripts/enrich-all.ts
 */
import { backfillUntilDone, countFilmsNeedingVisit } from "../lib/enrichBackfill";

async function main() {
  const waiting = await countFilmsNeedingVisit();
  console.log(`${waiting} film(s) awaiting enrichment.`);
  if (waiting === 0) {
    process.exit(0);
  }

  const result = await backfillUntilDone();
  console.log(
    `\nDone. ${result.enriched} film(s) enriched across ${result.rows} row(s), ` +
      `${result.failed} failed${result.more ? " — ceiling reached, run again" : ""}.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
