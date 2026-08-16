---
name: Social link pipeline
description: processSocialLink() architecture, shell-safety, and non-throwing contract
---

## Rule
All yt-dlp shell execution must use `execFile` with an argument **array** — never interpolate user-controlled input (URL) into a shell string.

**Why:** Code review caught this during initial implementation. The URL is passed as the last element of an args array to `execFileAsync(bin, args)` with no shell.

**How to apply:** Use `execFile(bin, ["-x", "--audio-format", "mp3", ..., videoUrl])` — never `exec(`${bin} ... "${videoUrl}"`)`.

## Rule
`processSocialLink(url)` must never throw to the route handler. Each async step (search-query fast path, Gemini URL analysis, audio fallback, runMoviePipeline) is individually wrapped in try/catch; failures return a graceful degraded response with `source` set to the last successful stage.

## Rule
Temp files created by yt-dlp must be cleaned up in two places:
1. In `downloadAudio`'s catch block (partial file yt-dlp may have written before failing).
2. In `extractMoviesFromAudio`'s finally block (successful download; local temp file AND the Gemini-hosted upload are both deleted).

## Caption/URL analysis (PRIMARY approach)

**Gemini + Google Search grounding, not platform-specific scrapers.** `geminiUrlAnalyzer.ts` hands the raw URL to Gemini with search grounding enabled — it looks up what the URL is about and extracts film references directly. Works uniformly for Instagram, TikTok, YouTube, Facebook, or anything else Google has indexed, with no per-platform HTML scraping and no RapidAPI key.

**2025-11: removed the Instagram/TikTok scraper (`socialScraper.ts`) and its `POST /movies/debug-social-link` debug route.** `fetchSocialCaption` (its only production-facing export) was never called from `processSocialLink.ts` — the Gemini-grounding step above made it dead code. The RapidAPI waterfall it fell back to was also unreliable (endpoints under maintenance, aggressive rate limits) and cost money per call. Do not re-add a platform-specific scraper as the primary path — extend `geminiUrlAnalyzer.ts` instead.

## Architecture
- `geminiUrlAnalyzer.ts` — Gemini + Google Search grounding, primary path for any URL
- `audioExtractor.ts` — yt-dlp binary (system Nix package, confirmed working) + Gemini native audio, fallback path
- `moviePipeline.ts` — shared Gemini→TMDB→DB logic
- `processSocialLink.ts` — orchestrator: search-query fast path → Gemini URL analysis → audio fallback → pipeline

## Secrets & tooling
- `GEMINI_API_KEY` — Gemini 2.5 Flash for both URL grounding and native audio extraction
- yt-dlp: installed as Nix system package (`yt-dlp`), confirmed at `/nix/store/.../bin/yt-dlp`
