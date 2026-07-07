---
name: Share intent flow — dry-run redesign
description: How the Android share-to-Film-Locker flow works after the July 2026 redesign
---

## Architecture

Share URL → `processLink({ dryRun: true })` → `ShareFilmSheet` (confirm) → `useAddMovie` → `BackHandler.exitApp()`

**Key decision — dry-run mode:** The backend `POST /movies/process-social-link` accepts `dryRun: boolean`. When true, Gemini + TMDB lookup runs but DB writes are skipped. Matches carry `poster_url`, `title`, `overview` so the UI can show a film card immediately. This lets users confirm before saving.

**Why:** Auto-saving without user confirmation was the old (bad) behaviour. The new flow shows a bottom sheet first.

## Files

- `artifacts/api-server/src/lib/moviePipeline.ts` — `enrichAndSaveMatches(rawMatches, warn, dryRun)` skips DB when `dryRun=true`
- `artifacts/api-server/src/lib/processSocialLink.ts` — passes `dryRun` through
- `artifacts/api-server/src/routes/movies/index.ts` — reads `dryRun` from body
- `artifacts/film-locker/components/ShareIntentHandler.tsx` — calls `dryRun: true`, shows `ShareFilmSheet`
- `artifacts/film-locker/components/ShareFilmSheet.tsx` — film cards + Add button + Return CTA

## BackHandler usage

`BackHandler.exitApp()` is called after the sheet closes (200 ms delay to let close animation run). This returns Android to whichever app the user shared from.

## Long-press remove

Already implemented via `onLongPress` on `MovieCard` → `handleDelete` in `watchlist.tsx` → Alert confirm → `deleteMovie`. The hint text "Hold to remove" is shown in the UI.

## APK builds

- Build that shipped the dry-run share flow: `95f1055e-dc46-45f7-a009-457cbcff8933`
- APK: https://expo.dev/artifacts/eas/fDITXBsUq1hvyeqVvMSYLGvBTXrfa5vkvU2XPiG1dOk.apk
