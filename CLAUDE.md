# Film Locker — working notes

Durable notes for anyone (human or Claude) picking this up cold. Facts that
were learned the slow way and are not obvious from the code. Operational
detail about accounts, DNS and store submission lives in `LAUNCH.md`; this
file is about working *in* the repo.

## Deploying

- **Railway auto-deploys from `main`, and only `main`.** Pushing to a
  feature branch deploys nothing. Migrations apply on container start (see
  `Dockerfile`), so a schema change ships with the merge that carries it.
  Until a branch is merged, the app is talking to a server that does not
  have its endpoints — which shows up as 404s on exactly the feature being
  tested, and is easily mistaken for a bug in the feature.
- The server logs `schemaUpToDate` on boot. `false` means the running code
  expects a schema the database does not have, and anything touching a new
  column will 500.
- **The database is Neon, not Railway.** Railway runs the API and holds the
  `DATABASE_URL` pointing at Neon. There is no Postgres service in the
  Railway project — backups and credential rotation happen in the Neon
  console. `LAUNCH.md` §2 has the detail.
- The mobile app is **not** deployed by a push. It ships in an EAS build,
  so a client-side change needs a new build in a tester's hands; a
  server-side change reaches everyone as soon as it deploys.

## Client/server compatibility

The generated react-query client **casts** responses (`as T` in
`custom-fetch.ts`) rather than validating them — the zod schemas are used
server-side only. So adding a field to a response is safe for older app
builds: they ignore what they do not know. Removing or renaming one is not.

This is what makes a server change safe to ship ahead of an app build.

## Commands

- **pnpm only.** The root `package.json` refuses npm and yarn outright.
- After editing `lib/api-spec/openapi.yaml`:
  `pnpm --filter @workspace/api-spec run codegen` — regenerates
  `@workspace/api-client-react` and `@workspace/api-zod`. Never hand-edit
  anything under a `generated/` directory.
- Typecheck: `pnpm run typecheck:libs` then
  `pnpm -r --filter @workspace/film-locker --filter @workspace/api-server run typecheck`.
- `pnpm run typecheck` (everything) **fails on `artifacts/mockup-sandbox`**
  and has for a while — a duplicated `@types/react` between radix and the
  workspace. Pre-existing and unrelated to app or API work; do not go
  chasing it, and do not read it as your change breaking the build.
- `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`, so a package
  published in the last 24h will not install.

## Testing

There is **no test runner**. Verification is done by writing a throwaway
script, running it with `tsx`, reading the output, and deleting it.

- `tsx` is not in the root bin — use `lib/db/node_modules/.bin/tsx`.
- **Anything that imports `react-native` cannot run under `tsx`**: RN's
  entry point is Flow-typed and esbuild fails with `Unexpected "typeof"`.
  So a component file is not executable here, however pure the function
  inside it is. Verify client logic by transcribing the predicate into a
  standalone script (say so when you do), or move the logic into an
  RN-free module and import that.
- A script needing workspace imports must live *inside* the package
  (e.g. `artifacts/api-server/src/__check.ts`), not in a temp directory,
  or module resolution fails.
- A real Postgres is available for schema and query work:
  `/usr/lib/postgresql/16/bin`, run as the `postgres` user, with the data
  directory somewhere that user can traverse (`/var/tmp/...`, *not* the
  scratchpad — its parent directories are not world-executable). Worth the
  two minutes: it catches SQL that typechecks and still fails.

## Migrations

- `lib/db/src/migrate.ts` is a **reconciling** migrator, not drizzle's. It
  runs each statement in its own SAVEPOINT and treats "already exists" as
  success, because the schema was once evolved with `drizzle-kit push` and
  the ledger fell out of step.
- Therefore: write `IF NOT EXISTS` where possible, and put
  `--> statement-breakpoint` between **every** statement.
- Add the journal entry in `lib/db/migrations/meta/_journal.json` by hand
  when writing a migration by hand.
- Use `migrate`, never `drizzle-kit push`, against the real database.

## Films and series

`movies`, `film_community_ratings`, `film_comments`, `film_notifications`
and `playlist_items` all carry a `media_type` of `movie` or `tv`.

- **A `tmdb_id` on its own is not a title.** TMDB numbers films and series
  in separate sequences, so 1399 is *Star Trek: First Contact* **and**
  *Game of Thrones*. Every query that matches on `tmdb_id` must match on
  `media_type` too, and every uniqueness rule already does. A map keyed on
  the id alone is the recurring shape of this bug — on the client use
  `titleKey()` from `hooks/useLockerTitles.ts`, on the server
  `filmCardKey()` from `lib/filmCards.ts`.
- **Absent means film**, everywhere: a column default on rows written
  before the column existed, a request from an app build that does not
  send it, a malformed value. `normalizeMediaType` (server) and
  `asMediaType` (client) are the only places that decide this.
- **Television has its own TMDB genre id list**, overlapping the film one.
  Read through the film map a sci-fi series comes back tagged only
  "Drama", because 10765 is not in it and 18 is. See `TMDB_TV_GENRE_MAP`.
- **A series has no runtime.** TMDB's `episode_run_time` is minutes per
  *episode*, which is a different question, so `movies.runtime` stays null
  for TV — the Kind filter hides the Length slider, and the enrichment
  queue excludes series from its "missing runtime" gate so they are not
  re-visited for ever.
- **A series' credits crew has no Director on it at all.** Creators come
  off the detail response (`created_by`); the person page reads
  `/person/{id}/tv_credits`, which `movie_credits` does not cover.
- **`X-Film-Locker-Supports-Tv` gates the whole feature.** This is the one
  place the "ship the server ahead of the app" rule above does NOT hold,
  because a series is not a new field — it is a new kind of thing in lists
  that have only ever held films. An old build does not ignore one: it
  saves the series' id with no `media_type`, so it lands as a film, and
  enrichment then writes a different film's cast and runtime over it. The
  server therefore serves television only to a caller that sends the
  header, which `custom-fetch.ts` does unconditionally.

## Who can see what

Two bars, and they are not interchangeable. Both live in
`routes/users.ts`; the server decides and sends `null` for a section the
caller may not see, so no screen ever infers visibility from the
relationship.

- **One-way** (`canViewDetails`, and `resolveListAccess` for the standalone
  endpoints): self, OR a public account, OR an accepted follow pointing at
  the target. Used for ratings, comments, public playlists, the follower
  and following lists, and **the watchlist**.
- **Mutual** ("Film Pals"): self, OR the follow is accepted in BOTH
  directions. Used for watched films only — `/users/:id/watched` and
  `recentWatched`.
- So the two halves of a locker are deliberately unequal: what somebody
  watched is a record of what they did, a watchlist is nearer a wishlist.
  Watched ⊆ watchlist always; never widen watched to match.
- A **block** reads as 404 everywhere, so a response never reveals that one
  exists. `resolveListAccess` already does this — prefer it to hand-rolled
  follow checks.
- Any endpoint serving somebody else's locker lists its columns explicitly.
  `movies.source_url` is theirs, and a whole-row select hands out every
  column the table later gains.
- The profile has a **preview** mode that shows you your own profile as a
  visitor sees it. Its rules are applied client-side (the server correctly
  sends you everything about yourself), so a change to either bar must be
  mirrored there or the preview starts lying.

## Adult content

- **`include_adult=false` only works on /search and /discover.** TMDB
  silently ignores it on /trending, /now_playing, /recommendations,
  /similar, /person/{id}/movie_credits and a fetch of /movie/{id} by id.
  Putting it on those URLs looks like a filter and is not one.
- So the gate is the **`adult` boolean on the object**, checked by
  `isAdult()` in `lib/tmdb.ts` at every site that returns a title. It
  rides along on responses already being fetched, so it costs nothing.
  Any new TMDB call that returns titles needs it.
- An adult title fetched by id returns **null**, which the route turns
  into a 404 — the same answer as an id TMDB has never heard of.
- **TMDB's `adult` means pornography, not an adults-only certificate.**
  Showgirls and Midnight Cowboy are `adult: false` and stay in.
  Certificates are a separate thing, on /release_dates, and nothing reads
  them.
- The Gemini prompts refuse pornographic titles too, which is not
  redundant: an extracted title *string* is shown to the user even when
  TMDB finds no match for it, so the TMDB filter alone cannot keep one
  off the screen.

## Things that bite

- **`optional` is not `nullable`, and the server validates its OWN
  responses.** Every route ends in `SomeResponse.parse(...)` from
  `@workspace/api-zod`, so a field the handler may set to `null` needs
  `nullable: true` in `openapi.yaml` — not just an absent `required`.
  Orval turns a plain optional into `.optional()`, which accepts a
  MISSING key and rejects an explicit `null`, so the endpoint 500s on
  exactly the rows that have nothing to put there. `mediaType` on
  `FeedItem` and `ConversationFeedItem` did this: /feed died on any
  playlist card and /conversations on any thread whose latest item was a
  chat message. Note which way round it fails — the field looks optional
  in the generated TYPES, so typecheck passes and the break only shows at
  runtime. Match the nullability of the sibling the field travels with
  (`tmdbId` on both of those is already `nullable: true`).
- **Clerk's token lives in chunked Keychain entries, and the swap must
  stay atomic.** SecureStore refuses values over 2048 bytes and Clerk's
  JWTs exceed that, so `lib/clerkTokenCache.ts` splits them across
  numbered keys behind a manifest. Chunks are written to whichever of two
  generations is NOT live, and the manifest swap is the single step that
  makes the new token current. Writing over the live chunks and saving
  the manifest last looks equivalent and is not: an interrupted write
  then leaves the manifest pointing at a mixture of two tokens, which
  joins into a JWT that verifies as neither and reads as being signed
  out. iOS suspends a backgrounded app mid-write where Android lets it
  finish, so that bug was iPhone-only. Also: never delete the entry when
  a READ throws — a momentary keychain failure becomes a permanent
  sign-out, and returning null is already enough to make Clerk refresh.
- **An enriched match must carry TMDB's fields, not the model's.** In
  `enrichAndSaveMatches`, `title`, `poster_url`, `overview` AND
  `release_year` are all replaced with what the TMDB hit returned. The
  year was once left as the model read it, and the prompts tell it to
  send `""` when it cannot tell — a poster usually does not print a year
  — so a film imported from a photo was saved with a blank year beside a
  title and poster that had both come from TMDB. Every client sends
  `match.release_year` verbatim, so whatever is on the match IS what
  lands in the locker. Add any new card field to that overwrite list.
- **TMDB returns empty strings, not nulls, for what it has not got
  yet.** `release_date`, `poster_path` and `overview` all come back `""`
  on a film indexed before it has them — which is the normal state of the
  upcoming titles this app is mostly used to save. So `??` is the wrong
  operator on any of them: it falls through on null only, and happily
  writes `""` over a good value. Use `||`. Worse, nothing used to repair
  such a row afterwards — the save path's upsert touches enrichment
  fields only, and the backfill never wrote `release_year` — so a film
  saved without a year kept the blank for ever and deleting and re-adding
  it was the only way out. The backfill now re-checks a yearless row
  weekly (its `enriched_at` stamp is ignored for that one test, with a
  week as the brake so a film TMDB genuinely has no date for is not
  re-fetched every boot), and the upsert fills a blank with
  `coalesce(nullif(existing, ''), new)` rather than leaving it.
- **Silent failure is the recurring bug in this codebase.** Bare `catch`,
  discarded Expo push tickets, `Promise.allSettled` skipping rejections
  with no log. Nearly every long-lived mystery this project has had traced
  back to one of these. When something "just stops working" with nothing in
  the logs, look for a swallowed error before anything else.
- React Native touch: `locationX` is re-resolved against whatever view is
  under the finger on every `ACTION_MOVE`. Only `ACTION_DOWN`'s is
  trustworthy — use `pageX` minus a captured origin for drags.
- `Share.share` ignores `url` on Android; use `expo-sharing`.
- **`KeyboardAvoidingView` needs `behavior="height"` on Android**, never
  `undefined` — undefined makes it do nothing, so the keyboard is drawn
  straight over whatever is being typed into. iOS wants `"padding"`.
- **`flex: 1` inside a container that has only `maxHeight` collapses to
  zero.** A bottom sheet styled `maxHeight: '75%'` with no height sizes to
  its content, so a `flex: 1` list inside it waits on a parent that is
  waiting on it, and renders 0px tall — the sheet opens, its header and
  search box show, and the list is simply absent. Use `flexShrink: 1` for
  a sheet that grows to content and caps, or give the sheet a definite
  `height` and then `flex: 1` works. This has now caused two separate
  "the list doesn't appear" bugs.
- A component declared inside a render body is a new function every render,
  so React unmounts and remounts its whole subtree.
- **Anything that runs at the root layout runs before the tabs exist.** A
  share intent into a cold app fires on the root's first render — before
  expo-router has a navigator (so `router.replace` throws, uncaught, and
  the app dies) and before `(tabs)/_layout` has wired the auth token (so
  requests go out unauthenticated and 401). Gate such work on
  `useRootNavigationState()?.key` and Clerk's `isLoaded`, and wire
  anything global at the ROOT rather than in a tab or behind a permission
  prompt.
- `eas-cli` is pinned to **26.0.0** in the build workflows. `latest`
  (27.5.0) broke local Android builds.

## Secrets

Never paste into chat, never commit: Railway/Neon/Clerk/Apify/Reddit
tokens, and the **FCM V1 service account JSON** (EAS credentials only).
`google-services.json` *is* committed — it ships in every APK and its key
is package-restricted, which is not the same thing.

`movies.source_url` is owner-private: it must never go out on an endpoint
serving somebody else's locker. The queries use explicit column lists to
enforce that — keep it that way rather than selecting whole rows.
