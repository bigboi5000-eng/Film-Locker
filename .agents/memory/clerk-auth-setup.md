---
name: Clerk auth setup — Film Locker
description: How Clerk was wired into the Expo app and Express API server, and the DB schema changes required for multi-user support.
---

# Clerk Auth Setup

## Pattern
- Clerk provisioned via `setupClerkWhitelabelAuth()` — secrets auto-written to env
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` passed via dev script (package.json) and build.js Metro env
- `@clerk/expo` + `expo-secure-store` + `expo-auth-session` + `expo-crypto` on Expo side
- `@clerk/express` + `http-proxy-middleware` + `@clerk/shared` on Express side

## Express wiring order (app.ts)
1. pinoHttp logger
2. `CLERK_PROXY_PATH` → `clerkProxyMiddleware()` — MUST be before `express.json()`
3. cors
4. `express.json()` + `urlencoded`
5. `clerkMiddleware(...)` with `publishableKeyFromHost` helper
6. general rate limiter (120/15min)
7. per-route heavy limiters (15/15min) on `/api/movies/process-social-link` and `/api/movies/ai-extract`
8. `/api` router

**Why:** Clerk proxy must stream raw bytes, so json() body parser must not run first.

## requireAuth middleware
- `artifacts/api-server/src/middlewares/requireAuth.ts`
- Calls `getAuth(req).userId`, 401 if missing, sets `(req as AuthedRequest).clerkUserId`
- All locker CRUD routes use it; discovery routes (trending, new-releases, search, tmdb/:id) remain public

## DB schema change for multi-user
- Added `clerkUserId: text("clerk_user_id").notNull().default("")` to `moviesTable`
- Unique index changed from `(tmdbId)` → `(tmdbId, clerkUserId)` — named `movies_tmdb_user_unique`
- `enrichAndSaveMatches` and `runMoviePipeline` now accept `clerkUserId` param (default "")
- `processSocialLink` also accepts `clerkUserId` and threads it through
- After schema changes: run `pnpm --filter @workspace/db run push-force`
- After schema changes: run `cd lib/db && pnpm exec tsc --build tsconfig.json` — API server uses composite TS references, reads from `lib/db/dist/`, NOT source

**Why:** `lib/db` uses `composite: true` with `emitDeclarationOnly`. Editing `.ts` files alone is not enough — must rebuild `lib/db` to update `dist/*.d.ts` or the API server's tsc won't see new columns.

## Expo auth screens
- `app/(auth)/_layout.tsx` — redirects to `/(tabs)/` if already signed in
- `app/(auth)/sign-in.tsx` — email/password + Google OAuth + Apple OAuth (iOS only)
- `app/(auth)/sign-up.tsx` — email/password + email verification + Google/Apple OAuth
- `app/(tabs)/_layout.tsx` — redirects to `/(auth)/sign-in` if not signed in; calls `setAuthTokenGetter(() => getToken())` in useEffect

## How to apply
- Always call `pnpm --filter @workspace/db run push-force` + `cd lib/db && pnpm exec tsc --build tsconfig.json` after any schema change
- Never add `keyGenerator` to express-rate-limit that uses `req.ip` directly — use default or use the `ipKeyGenerator` helper
- Apple OAuth: only show button on iOS (`Platform.OS === 'ios'`); requires Apple Developer + Clerk dashboard config
- `WebBrowser.maybeCompleteAuthSession()` must be called at module level in every OAuth-using screen
