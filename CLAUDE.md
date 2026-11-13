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

## Things that bite

- **Silent failure is the recurring bug in this codebase.** Bare `catch`,
  discarded Expo push tickets, `Promise.allSettled` skipping rejections
  with no log. Nearly every long-lived mystery this project has had traced
  back to one of these. When something "just stops working" with nothing in
  the logs, look for a swallowed error before anything else.
- React Native touch: `locationX` is re-resolved against whatever view is
  under the finger on every `ACTION_MOVE`. Only `ACTION_DOWN`'s is
  trustworthy — use `pageX` minus a captured origin for drags.
- `Share.share` ignores `url` on Android; use `expo-sharing`.
- A component declared inside a render body is a new function every render,
  so React unmounts and remounts its whole subtree.
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
