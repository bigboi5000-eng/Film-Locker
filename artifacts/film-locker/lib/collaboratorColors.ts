/**
 * A colour per person on a shared playlist.
 *
 * The badges on a poster say WHO has seen that film, and the only thing
 * carrying that is the colour — a 16px circle has room for two letters and
 * no more. So the colour has to be stable: the same person must be the same
 * colour at the top of the screen and on every poster below it, and must
 * not change when somebody else is invited or leaves.
 *
 * Within one viewer's session that stability comes from the server, which
 * returns the people in a fixed order (owner first, then collaborators by
 * invite date) and never re-orders them.
 *
 * The mapping is per-VIEWER, not global: you are always blue, whoever you
 * are. Two people looking at the same list therefore see different colours
 * on the same friend, which is fine — nobody compares two phones, and
 * "which one is me" is the question asked on every glance at the grid.
 * Hunting for your own colour in a legend to answer it is the thing worth
 * avoiding.
 */

/**
 * Six colours for an owner plus five collaborators, which is the cap.
 *
 * Chosen to stay legible drawn on top of a film poster in either theme,
 * which is why they are all mid-to-dark saturated tones with white text
 * rather than anything from the palette's soft end — a badge sits on
 * arbitrary artwork and cannot rely on the background behind it.
 *
 * Red is deliberately absent. It means "destructive" everywhere else in the
 * app, and a person's badge is not a warning.
 */
export const COLLABORATOR_COLORS = [
  '#2563EB', // blue — always you
  '#F59E0B', // amber
  '#16A34A', // green
  '#DB2777', // pink
  '#7C3AED', // violet
  '#0D9488', // teal
] as const;

/** Your own badge, on any list. */
export const OWN_COLLABORATOR_COLOR = COLLABORATOR_COLORS[0];

/**
 * The colour for the person at `index`.
 *
 * Wraps rather than throws past the end. The cap is enforced server-side, so
 * a seventh person should be impossible — but a screen that crashes over a
 * colour is worse than two people sharing one, and the initials still tell
 * them apart.
 */
export function collaboratorColor(index: number): string {
  if (index < 0) return COLLABORATOR_COLORS[0];
  return COLLABORATOR_COLORS[index % COLLABORATOR_COLORS.length]!;
}

/**
 * clerkId → colour, for everybody on one playlist, from one viewer's seat.
 *
 * The viewer takes blue and the rest take the remaining colours in the
 * server's order, so the set fits exactly: six colours, an owner plus five
 * collaborators, one of whom is you.
 *
 * A viewer who is not on the list at all — somebody reading a public
 * playlist — has no "you" to colour, so the owner takes blue and the rest
 * follow in order. They still get a complete, consistent legend; it just
 * is not about them.
 */
export function collaboratorColorMap(
  people: { clerkId: string }[],
  viewerClerkId: string | null | undefined
): Map<string, string> {
  const map = new Map<string, string>();
  const viewerIsOnList =
    viewerClerkId != null && people.some((p) => p.clerkId === viewerClerkId);

  if (!viewerIsOnList) {
    people.forEach((p, i) => map.set(p.clerkId, collaboratorColor(i)));
    return map;
  }

  map.set(viewerClerkId!, OWN_COLLABORATOR_COLOR);
  let next = 1;
  for (const p of people) {
    if (p.clerkId === viewerClerkId) continue;
    map.set(p.clerkId, collaboratorColor(next));
    next += 1;
  }
  return map;
}

/**
 * Up to two letters for a badge, from whatever the person has.
 *
 * Two rather than the five the wider app uses for avatars: this is drawn at
 * 18px on top of a poster, and five characters there is a smudge. The full
 * name is in the legend at the top of the list, which is what the badge
 * points at.
 */
export function badgeInitials(person: {
  displayInitials?: string | null;
  username?: string | null;
  clerkId: string;
}): string {
  const source = person.displayInitials || person.username || person.clerkId;
  return source.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
}
