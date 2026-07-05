# Film Locker

A dark-mode native mobile app where users paste social media captions, AI-style heuristics extract movie titles, TMDB confirms them with poster art, and the resulting films are saved to a personal "locker" that persists across sessions.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/film-locker run dev` — run the Expo mobile app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `TMDB_API_KEY` — TMDB v3 API key

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile: Expo SDK 54, Expo Router v6, React Native 0.81
- API: Express 5
- DB: PostgreSQL + Drizzle ORM (`lib/db/src/schema/movies.ts`)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Movie data: TMDB API v3 (server-side, via `artifacts/api-server/src/lib/tmdb.ts`)
- Caption parsing: heuristic text extraction (`artifacts/api-server/src/lib/captionParser.ts`)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for API contract
- `lib/db/src/schema/movies.ts` — movies table (unique constraint on tmdb_id)
- `artifacts/api-server/src/routes/movies/` — CRUD + parse-caption routes
- `artifacts/api-server/src/lib/tmdb.ts` — TMDB search helper
- `artifacts/api-server/src/lib/captionParser.ts` — heuristic title extractor
- `artifacts/film-locker/app/(tabs)/index.tsx` — main locker screen
- `artifacts/film-locker/components/MovieCard.tsx` — poster card (long-press to delete)
- `artifacts/film-locker/components/ExtractSheet.tsx` — bottom sheet with TMDB results
- `artifacts/film-locker/constants/colors.ts` — dark cinema palette (gold accent #C8A84B)

## Architecture decisions

- Caption parsing is heuristic-only (no AI API key required): extracts quoted strings, hashtags, and Title Case runs, then confirms each against TMDB search.
- `POST /movies/parse-caption` is declared before `DELETE /movies/:id` in the router to prevent Express 5 param collision.
- Movies are unique by `tmdb_id` (DB unique index); the POST route is idempotent — returns existing record on conflict rather than erroring.
- `lib/api-spec/package.json` codegen script patches `lib/api-zod/src/index.ts` after orval runs to remove the duplicate `./generated/types` barrel export that causes TS2308 errors.

## Product

- Users paste any social media caption into the top input and tap "Extract Movies"
- The server extracts potential movie titles using text heuristics, searches TMDB for each, and returns up to 24 poster candidates
- A bottom sheet shows each candidate with poster, title, year and overview — tap + to lock it in
- The locker grid shows all saved movies as poster cards; long-press to remove
- Data persists in PostgreSQL across sessions

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after editing `lib/api-spec/openapi.yaml`
- The codegen script patches `lib/api-zod/src/index.ts` after orval — don't manually restore the two-line barrel
- `expo-image` placeholder prop accepts require() or URI, not `{ color }` object
- useNativeDriver warnings in web preview are expected — app targets iOS/Android via Expo Go
