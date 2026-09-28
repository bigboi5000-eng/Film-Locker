/**
 * Removes app rows for users whose Clerk identity no longer exists.
 *
 * DELETE /users/me deletes the app's rows and the Clerk identity together,
 * so an account removed through the app leaves nothing behind. Anything
 * removed another way — from Clerk's dashboard, or before that endpoint
 * existed — deletes the identity only. The app's row survives, and a
 * deleted person keeps appearing in Find People with a Follow button next
 * to their name.
 *
 * There is no webhook from Clerk, so nothing notices. This script is the
 * reconciliation.
 *
 * Run it where DATABASE_URL and CLERK_SECRET_KEY are set, which means the
 * deployed container rather than a laptop. It is bundled by the build, so
 * plain node runs it and no dev dependency is needed:
 *
 *   node dist/scripts/prune-orphan-users.mjs            # dry run, changes nothing
 *   node dist/scripts/prune-orphan-users.mjs --live     # also list the live accounts
 *   node dist/scripts/prune-orphan-users.mjs --delete   # actually removes the orphans
 */
import { clerkClient } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { deleteUserData } from "../lib/deleteUserData";

/** Does this Clerk user still exist? */
async function existsInClerk(clerkId: string): Promise<boolean> {
  try {
    await clerkClient.users.getUser(clerkId);
    return true;
  } catch (err) {
    // 404 means genuinely gone. Anything else — a network blip, a bad key,
    // a rate limit — must not be read as "deleted", or this script would
    // wipe live accounts. Rethrow and stop.
    const status = (err as { status?: number })?.status;
    if (status === 404) return false;
    throw err;
  }
}

async function main() {
  const reallyDelete = process.argv.includes("--delete");
  const showLive = process.argv.includes("--live");

  const users = await db
    .select({ clerkId: usersTable.clerkId, username: usersTable.username, email: usersTable.email })
    .from(usersTable);

  console.log(`Checking ${users.length} user row(s) against Clerk…\n`);

  const orphans: typeof users = [];
  const live: typeof users = [];
  for (const user of users) {
    if (await existsInClerk(user.clerkId)) live.push(user);
    else orphans.push(user);
  }

  console.log(`${live.length} live, ${orphans.length} orphaned.\n`);

  if (showLive) {
    console.log(`Live accounts (${live.length}):\n`);
    for (const u of live) {
      console.log(`  ${u.username ?? "(no username)"}  ${u.email}  ${u.clerkId}`);
    }
    console.log("");
  }

  if (orphans.length === 0) {
    console.log("No orphaned rows. Every user row has a live Clerk identity.");
    return;
  }

  console.log(`Rows with no Clerk identity (${orphans.length}):\n`);
  for (const o of orphans) {
    console.log(`  ${o.username ?? "(no username)"}  ${o.email}  ${o.clerkId}`);
  }

  if (!reallyDelete) {
    console.log("\nDry run — nothing deleted. Re-run with --delete to remove them.");
    return;
  }

  console.log("\nDeleting…");
  let ok = 0;
  for (const o of orphans) {
    try {
      await deleteUserData(o.clerkId);
      console.log(`  removed ${o.username ?? o.email}`);
      ok++;
    } catch (err) {
      console.error(`  FAILED ${o.username ?? o.email}:`, err);
    }
  }
  console.log(`\nDone. Removed ${ok} of ${orphans.length}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
