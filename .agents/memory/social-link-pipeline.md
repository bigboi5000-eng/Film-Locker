---
name: Social link pipeline
description: processSocialLink() architecture, Instagram caption scraping, shell-safety, and non-throwing contract
---

## Rule
All yt-dlp shell execution must use `execFile` with an argument **array** — never interpolate user-controlled input (URL) into a shell string.

**Why:** Code review caught this during initial implementation. The URL is passed as the last element of an args array to `execFileAsync(bin, args)` with no shell.

**How to apply:** Use `execFile(bin, ["-x", "--audio-format", "mp3", ..., videoUrl])` — never `exec(`${bin} ... "${videoUrl}"`)`.

## Rule
`processSocialLink(url)` must never throw to the route handler. All three async steps (caption fetch, audio transcription, runMoviePipeline) are individually wrapped in try/catch; failures return a graceful degraded response with `source` set to the last successful stage.

## Rule
Temp files created by yt-dlp must be cleaned up in two places:
1. In `downloadAudio`'s catch block (partial file yt-dlp may have written before failing).
2. In `transcribeAudio`'s finally block (successful download, Whisper may fail after).

## Instagram caption scraping (PRIMARY approach)

**Use direct HTML scrape of `og:description` as the first method, not RapidAPI.**

The RapidAPI `instagram-scraper-stable-api` endpoints are unreliable: they change naming conventions, go under maintenance, and rate-limit aggressively during debugging sessions. The HTML scrape is dependency-free and works for all public posts.

```
fetchInstagramHtmlCaption(url):
  1. Strip tracking params, GET canonical URL with mobile UA
  2. Check final URL pathname (not res.url string) for /accounts/login to avoid
     false-null on shortcodes containing "login"
  3. Check HTML body for login-wall markers
  4. Extract og:description via <meta> tag scan (attribute-order-agnostic)
  5. Decode HTML entities using String.fromCodePoint (not fromCharCode — needed for emoji)
  6. Return decoded string or null
```

**Why RapidAPI fails:** v2 endpoint goes "under maintenance"; v1/reel_title return "Data not found" when rate-limited. The `get_reel_title.php` response put caption in `post_caption` not `title` — the `extractIgCaption` function must check `post_caption` first. The `title` field is always `"Instagram"` (browser page title) and must be filtered out via `IG_JUNK_TITLES`.

**RapidAPI waterfall is kept as fallback** (v2 → v1 → reel_title) after HTML scrape fails.

## Architecture
- `socialScraper.ts` — HTML scrape (primary) + RapidAPI fallback for Instagram; RapidAPI for TikTok
- `audioExtractor.ts` — yt-dlp binary (system Nix package, confirmed working) + Gemini native audio
- `moviePipeline.ts` — shared Gemini→TMDB→DB logic
- `processSocialLink.ts` — orchestrator: caption → audio fallback → pipeline

## Debug endpoint
`POST /api/movies/debug-social-link` with `{"url":"..."}` returns:
- `scraper.htmlScrape.caption` — what the HTML scrape extracted
- `scraper.rapidApiEndpoints[]` — raw JSON from each RapidAPI endpoint
- `scraper.extractedCaption` — first non-null caption found
- `gemini.input/output/error` — what was sent to Gemini and what came back

## Secrets & tooling
- `RAPIDAPI_KEY` — RapidAPI auth header `x-rapidapi-key`
- `GEMINI_API_KEY` — Gemini 2.5 Flash for both text and audio extraction
- yt-dlp: installed as Nix system package (`yt-dlp`), confirmed at `/nix/store/.../bin/yt-dlp`
