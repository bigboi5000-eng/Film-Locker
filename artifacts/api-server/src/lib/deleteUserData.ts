/**
 * deleteUserData.ts
 *
 * Removes every row this app holds for one user.
 *
 * Extracted from DELETE /users/me so the cleanup script can reuse it. Two
 * copies of a cascade this wide is how one of them quietly stops covering a
 * table that was added later, leaving rows behind that nothing ever looks
 * for again.
 *
 * Deliberately does not touch Clerk. The route deletes the Clerk identity
 * itself afterwards; the cleanup script runs against users whose Clerk
 * identity is already gone.
 */
import { eq, or } from "drizzle-orm";
import {
  db,
  usersTable,
  moviesTable,
  followsTable,
  filmNotificationsTable,
  conversationMessagesTable,
  filmCommentsTable,
  filmCommunityRatingsTable,
  playlistsTable,
  playlistFollowsTable,
  feedbackTable,
  blocksTable,
  reportsTable,
} from "@workspace/db";

/**
 * Deletes the user's row and everything hanging off it, in one transaction.
 * playlist_items go with their playlist via the foreign key's cascade.
 */
export async function deleteUserData(clerkUserId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(conversationMessagesTable)
      .where(
        or(
          eq(conversationMessagesTable.fromUserId, clerkUserId),
          eq(conversationMessagesTable.toUserId, clerkUserId)
        )
      );
    await tx
      .delete(filmNotificationsTable)
      .where(
        or(
          eq(filmNotificationsTable.fromUserId, clerkUserId),
          eq(filmNotificationsTable.toUserId, clerkUserId)
        )
      );
    await tx
      .delete(followsTable)
      .where(
        or(
          eq(followsTable.followerId, clerkUserId),
          eq(followsTable.followeeId, clerkUserId)
        )
      );
    await tx
      .delete(blocksTable)
      .where(
        or(
          eq(blocksTable.blockerId, clerkUserId),
          eq(blocksTable.blockedId, clerkUserId)
        )
      );
    // Reports you filed are yours to delete. Reports filed about you are
    // retained as a safety record — deleting your account shouldn't erase
    // evidence someone else submitted about your conduct.
    await tx.delete(reportsTable).where(eq(reportsTable.reporterId, clerkUserId));
    // Follows of other people's playlists. Follows OF this user's playlists
    // go with the playlists themselves, which cascade on delete below.
    await tx.delete(playlistFollowsTable).where(eq(playlistFollowsTable.userId, clerkUserId));
    await tx.delete(filmCommentsTable).where(eq(filmCommentsTable.userId, clerkUserId));
    await tx.delete(filmCommunityRatingsTable).where(eq(filmCommunityRatingsTable.userId, clerkUserId));
    await tx.delete(playlistsTable).where(eq(playlistsTable.userId, clerkUserId));
    await tx.delete(feedbackTable).where(eq(feedbackTable.userId, clerkUserId));
    await tx.delete(moviesTable).where(eq(moviesTable.clerkUserId, clerkUserId));
    await tx.delete(usersTable).where(eq(usersTable.clerkId, clerkUserId));
  });
}
