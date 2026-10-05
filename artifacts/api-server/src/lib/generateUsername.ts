/**
 * generateUsername.ts
 *
 * Gives every account a username, so nothing is ever posted without a name
 * attached to it.
 *
 * App Review rejected the app under guideline 1.2 for letting users "post
 * content anonymously". Usernames were optional: an account that never set
 * one displayed as "Unnamed user" everywhere it appeared, including beside
 * its comments. That is anonymous posting, and it is what the rejection was
 * about.
 *
 * Generating one at sign-in rather than demanding it through a form keeps
 * the account attributable from its very first action, with nothing for the
 * user to skip, postpone or dismiss. They can change it afterwards in
 * Profile; they cannot end up without one.
 */
import { sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

/** Matches the length the API accepts in UpdateMeBody. */
const MAX_LENGTH = 30;
const MIN_LENGTH = 2;

/**
 * A readable starting point taken from the email's local part — "jake.tanner"
 * becomes "jaketanner" — rather than a random string, which nobody would
 * recognise as themselves.
 */
function seedFrom(email: string): string {
  const local = email.split("@")[0] ?? "";
  const cleaned = local.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (cleaned.length >= MIN_LENGTH) return cleaned.slice(0, MAX_LENGTH - 4);
  return "film";
}

/** Is this name free? Case-insensitive, matching the index on the column. */
async function isAvailable(candidate: string): Promise<boolean> {
  const [taken] = await db
    .select({ clerkId: usersTable.clerkId })
    .from(usersTable)
    .where(sql`lower(${usersTable.username}) = ${candidate.toLowerCase()}`)
    .limit(1);
  return !taken;
}

/**
 * Find a free username based on `email`.
 *
 * Tries the bare seed first, then appends digits. Returns null if it cannot
 * find one, which the caller should treat as "leave it unset and try again
 * next sign-in" rather than as a failure worth breaking sign-in over.
 */
export async function generateUsername(email: string): Promise<string | null> {
  const seed = seedFrom(email);

  if (await isAvailable(seed)) return seed;

  // Widen the random range as attempts go on, so a popular seed does not
  // spend every try colliding inside the same small pool.
  for (let attempt = 0; attempt < 12; attempt++) {
    const range = 100 * 10 ** Math.floor(attempt / 4);
    const candidate = `${seed}${Math.floor(Math.random() * range)}`;
    if (candidate.length <= MAX_LENGTH && (await isAvailable(candidate))) return candidate;
  }

  return null;
}
