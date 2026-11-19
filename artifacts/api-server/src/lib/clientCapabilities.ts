/**
 * clientCapabilities.ts
 *
 * What the app build making this request can cope with.
 *
 * Normally the server can ship ahead of the app freely: the generated
 * client CASTS responses rather than validating them, so a field an old
 * build has never heard of is simply ignored (see custom-fetch.ts, and the
 * note in CLAUDE.md). Television breaks that rule, because it is not a new
 * field — it is a new KIND OF THING in lists that until now only ever held
 * films.
 *
 * An old build handed a series does not ignore it. It shows it, and when
 * the user saves it, it POSTs the series' tmdb_id with no media_type — so
 * it lands in the locker as a film. Background enrichment then looks that
 * id up under /movie and writes a completely different film's director,
 * cast, genres and runtime over it, because TMDB numbers the two
 * separately. The result is a locker entry reading "Game of Thrones,
 * directed by Jonathan Frakes, 111 minutes", and it stays that way.
 *
 * Railway deploys on a merge to main; an app build reaches a tester days
 * later and some never update at all. So the server waits to be told.
 */
import type { Request } from "express";

/** Set by the app's custom-fetch on every request, from the build onward. */
const HEADER = "x-film-locker-supports-tv";

/**
 * Whether this caller may be served television.
 *
 * Absent means no. Silence is an old build, and the whole point is that an
 * old build must keep seeing exactly what it saw before.
 */
export function clientSupportsTv(req: Pick<Request, "get">): boolean {
  const raw = req.get(HEADER);
  return raw === "1" || raw?.toLowerCase() === "true";
}
