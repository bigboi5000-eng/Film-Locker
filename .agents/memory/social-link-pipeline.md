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

## Caption/URL analysis

**Direct page scrape first, Gemini search-grounding for non-Instagram only, Gemini content-understanding as the real fallback.**

**2025-11: removed the RapidAPI-backed Instagram/TikTok scraper (`socialScraper.ts`) and its `POST /movies/debug-social-link` debug route**, in favour of `geminiUrlAnalyzer.ts` (Gemini + Google Search grounding) as the sole primary path. Do not bring RapidAPI back — per the person building this, it never reliably worked even as a backup tier in the old scraper, on top of costing money per call and having endpoints go under maintenance.

**2026-08: Gemini search-grounding turned out to be unreliable specifically for Instagram** — Google's index of Instagram is sparse (login walls keep most of it out), so `analyzeUrlForFilms()` regularly found nothing, and when it couldn't verify a match it sometimes substituted plausible-sounding content from the creator's other posts instead of reporting nothing (fixed with a FOUND/NOT_FOUND verification prefix in the prompt, but the underlying index gap remains). Fix: added `pageCaptionScraper.ts` — a free HTTP GET for the page's `og:description` meta tag — as a step *before* Gemini search-grounding, and **`processSocialLink.ts` now skips the Gemini search-grounding step entirely for Instagram URLs**, falling straight through to the audio/video steps instead.

**Guiding principle: Gemini's job is to understand content it's actually been given (a scraped caption, or downloaded audio/video), not to search the web trying to find the URL.** Search-grounding-by-URL is a guessing game for any platform Google doesn't index well; keep it only where it's actually earning its keep (currently: YouTube, TikTok, Facebook, generic URLs). If those start showing the same guessing failure mode, exclude them here the same way Instagram was excluded — don't reach for a platform-specific scraper or paid API as the fix.

## Architecture
- `pageCaptionScraper.ts` — free direct HTML `og:description` scrape, tried first, no API cost. `detectPlatform()`/`Platform` are exported for reuse (e.g. by `processSocialLink.ts` to decide whether to skip Gemini search-grounding).
- `geminiUrlAnalyzer.ts` — Gemini + Google Search grounding. Skipped for Instagram (see above); still primary fallback for other platforms after the caption scrape comes up empty.
- `audioExtractor.ts` / `videoExtractor.ts` — yt-dlp binary (system Nix package, confirmed working) + Gemini native audio/video understanding. This is the real "Gemini understands the content" path — it's handed actual downloaded media, not asked to search for a URL.
- `moviePipeline.ts` — shared Gemini→TMDB→DB logic
- `processSocialLink.ts` — orchestrator: mixed-text/search-query fast path → direct caption scrape → Gemini URL search-grounding (non-Instagram only) → audio fallback → video fallback → pipeline

## Secrets & tooling
- `GEMINI_API_KEY` — Gemini 2.5 Flash for both URL grounding and native audio extraction
- yt-dlp: installed as Nix system package (`yt-dlp`), confirmed at `/nix/store/.../bin/yt-dlp`
