import { and, eq, or } from "drizzle-orm";
import { db, followsTable } from "@workspace/db";
import { isBlockedEitherWay } from "./blocks";

/**
 * Whether two people are Film Pals: each follows the other, accepted, and
 * neither has blocked the other.
 *
 * Lifted out of routes/notifications.ts, where it governed who may message
 * whom, because collaborating on somebody's playlist asks the same
 * question. Following alone is not enough and never was — that is a
 * one-sided channel into a stranger's list, and it also made the interface
 * incoherent, with Film Pals presented as the thing that connects two
 * people while conferring no actual permission.
 *
 * Two accepted rows are required, and the unique index on
 * (follower_id, followee_id) is what makes counting them safe: neither
 * direction can be present twice, so two rows always means one each way.
 */
export async function areFilmPals(userA: string, userB: string): Promise<boolean> {
  if (userA === userB) return false;
  if (await isBlockedEitherWay(userA, userB)) return false;

  const rows = await db
    .select({ followerId: followsTable.followerId })
    .from(followsTable)
    .where(
      and(
        eq(followsTable.status, "accepted"),
        or(
          and(eq(followsTable.followerId, userA), eq(followsTable.followeeId, userB)),
          and(eq(followsTable.followerId, userB), eq(followsTable.followeeId, userA))
        )
      )
    );
  return rows.length === 2;
}
