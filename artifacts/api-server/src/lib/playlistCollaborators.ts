import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  playlistCollaboratorsTable,
  usersTable,
  MAX_PLAYLIST_COLLABORATORS,
} from "@workspace/db";

export { MAX_PLAYLIST_COLLABORATORS };

export type CollaboratorProfile = {
  clerkId: string;
  username: string | null;
  avatarUrl: string | null;
  displayInitials: string | null;
  isOwner: boolean;
};

/**
 * The clerkIds of everyone invited to edit a playlist, oldest invite first.
 *
 * The owner is NOT in here. Callers that want "everyone on the list" put
 * the owner at the front themselves, which keeps the owner's position
 * fixed at index 0 and is what makes the client's colour-per-person stable:
 * the badge colour is the index in that list, so it must not shift when
 * somebody new is invited.
 */
export async function getCollaboratorIds(playlistId: number): Promise<string[]> {
  const rows = await db
    .select({ userId: playlistCollaboratorsTable.userId })
    .from(playlistCollaboratorsTable)
    .where(eq(playlistCollaboratorsTable.playlistId, playlistId))
    .orderBy(asc(playlistCollaboratorsTable.createdAt), asc(playlistCollaboratorsTable.id));
  return rows.map((r) => r.userId);
}

/**
 * Whether somebody may add or remove films: the owner, or anyone invited.
 *
 * Takes the owner's id rather than looking it up, because every caller has
 * already fetched the playlist row to tell 404 from 403 and a second read
 * of the same row would only be a chance for the two to disagree.
 */
export async function canEditPlaylist(
  playlistId: number,
  ownerId: string,
  clerkUserId: string
): Promise<boolean> {
  if (ownerId === clerkUserId) return true;
  const rows = await db
    .select({ id: playlistCollaboratorsTable.id })
    .from(playlistCollaboratorsTable)
    .where(
      and(
        eq(playlistCollaboratorsTable.playlistId, playlistId),
        eq(playlistCollaboratorsTable.userId, clerkUserId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * The people on a playlist, as the client shows them: owner first, then
 * collaborators in invite order.
 *
 * Profiles are fetched in one query and then re-sorted into that order
 * rather than ordered by the join, because a left join over two tables
 * gives no stable ordering and the colour assignment depends on one.
 * Somebody whose users row is missing (deleted account, webhook not yet
 * delivered) still gets an entry with nulls, so the list of ids and the
 * list shown never disagree about who is on it.
 */
export async function listCollaboratorProfiles(
  playlistId: number,
  ownerId: string
): Promise<CollaboratorProfile[]> {
  const collaboratorIds = await getCollaboratorIds(playlistId);
  const everyone = [ownerId, ...collaboratorIds];

  const profiles = await db
    .select({
      clerkId: usersTable.clerkId,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
      displayInitials: usersTable.displayInitials,
    })
    .from(usersTable)
    .where(inArray(usersTable.clerkId, everyone));

  const byId = new Map(profiles.map((p) => [p.clerkId, p]));

  return everyone.map((clerkId) => {
    const p = byId.get(clerkId);
    return {
      clerkId,
      username: p?.username ?? null,
      avatarUrl: p?.avatarUrl ?? null,
      displayInitials: p?.displayInitials ?? null,
      isOwner: clerkId === ownerId,
    };
  });
}
