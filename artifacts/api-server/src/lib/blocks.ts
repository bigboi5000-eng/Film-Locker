import { and, eq, or } from "drizzle-orm";
import { db, blocksTable } from "@workspace/db";

/** True if either person has blocked the other. */
export async function isBlockedEitherWay(userA: string, userB: string): Promise<boolean> {
  const [row] = await db
    .select({ id: blocksTable.id })
    .from(blocksTable)
    .where(
      or(
        and(eq(blocksTable.blockerId, userA), eq(blocksTable.blockedId, userB)),
        and(eq(blocksTable.blockerId, userB), eq(blocksTable.blockedId, userA))
      )
    );
  return Boolean(row);
}

/**
 * Everyone `userId` is in a block relationship with, in either direction —
 * for filtering a list (e.g. comments) down to authors that should be
 * hidden from this viewer, without an isBlockedEitherWay call per item.
 */
export async function getMutualBlockSet(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ blockerId: blocksTable.blockerId, blockedId: blocksTable.blockedId })
    .from(blocksTable)
    .where(or(eq(blocksTable.blockerId, userId), eq(blocksTable.blockedId, userId)));

  const set = new Set<string>();
  for (const r of rows) {
    set.add(r.blockerId === userId ? r.blockedId : r.blockerId);
  }
  return set;
}
