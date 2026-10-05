/**
 * Gives a username to every existing account that has none.
 *
 * POST /users/sync generates one from now on, but only when an account
 * next signs in. Rows belonging to accounts that do not sign in again would
 * keep displaying as "Unnamed user" beside comments they have already
 * posted — which is the anonymous posting guideline 1.2 rejected the app
 * over, still visible in the data a reviewer looks at.
 *
 * Run it on the deployed container, where DATABASE_URL is:
 *
 *   node dist/scripts/backfill-usernames.mjs            # dry run
 *   node dist/scripts/backfill-usernames.mjs --write    # apply
 */
import { isNull } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { generateUsername } from "../lib/generateUsername";
import { eq } from "drizzle-orm";

async function main() {
  const write = process.argv.includes("--write");

  const nameless = await db
    .select({ clerkId: usersTable.clerkId, email: usersTable.email })
    .from(usersTable)
    .where(isNull(usersTable.username));

  if (nameless.length === 0) {
    console.log("Every account already has a username.");
    return;
  }

  console.log(`${nameless.length} account(s) without a username:\n`);

  for (const user of nameless) {
    const generated = await generateUsername(user.email);
    if (!generated) {
      console.log(`  ${user.email}  ->  (could not find a free name)`);
      continue;
    }

    if (!write) {
      console.log(`  ${user.email}  ->  ${generated}`);
      continue;
    }

    try {
      await db
        .update(usersTable)
        .set({ username: generated })
        .where(eq(usersTable.clerkId, user.clerkId));
      console.log(`  ${user.email}  ->  ${generated}`);
    } catch (err) {
      console.error(`  ${user.email}  FAILED:`, err);
    }
  }

  if (!write) console.log("\nDry run — nothing written. Re-run with --write to apply.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
