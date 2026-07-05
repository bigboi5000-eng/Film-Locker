---
name: Social link pipeline
description: processSocialLink() architecture, shell-safety fix, and non-throwing contract
---

## Rule
All yt-dlp shell execution must use `execFile` with an argument **array** — never interpolate user-controlled input (URL) into a shell string. `exec(commandString)` with a URL is a command-injection vector even inside double quotes (bash evaluates `$(...)`).

**Why:** Code review caught this during initial implementation. The URL is passed as the last element of an args array to `execFileAsync(bin, args)` with no shell.

**How to apply:** Use `execFile(bin, ["-x", "--audio-format", "mp3", ..., videoUrl])` — never `exec(`${bin} ... "${videoUrl}"`)`.

## Rule
`processSocialLink(url)` must never throw to the route handler. All three async steps (caption fetch, audio transcription, runMoviePipeline) are individually wrapped in try/catch; failures return a graceful degraded response with `source` set to the last successful stage.

**Why:** Explicit design contract; Gemini/TMDB/DB failures should not 500 the social-link endpoint.

## Rule
Temp files created by yt-dlp must be cleaned up in two places:
1. In `downloadAudio`'s catch block (partial file yt-dlp may have written before failing).
2. In `transcribeAudio`'s finally block (successful download, Whisper may fail after).

**Why:** Repeated yt-dlp timeouts accumulate stale temp files without dual cleanup.

## Architecture
- `socialScraper.ts` — RapidAPI caption (instagram-scraper-api2 / tiktok-scraper7)
- `audioTranscriber.ts` — yt-dlp binary (~/.local/bin/yt-dlp or YT_DLP_PATH) + OpenAI whisper-1
- `moviePipeline.ts` — shared Gemini→TMDB→DB logic (used by /ai-extract AND /process-social-link)
- `processSocialLink.ts` — orchestrator: caption → audio fallback → pipeline

## RapidAPI endpoints used
- Instagram: `instagram-scraper-api2.p.rapidapi.com` → `GET /v1/post_info?code_or_id_or_url={url}` → `data.data.caption`
- TikTok: `tiktok-scraper7.p.rapidapi.com` → `GET /post?url={encodedUrl}` → `data.data.desc`
- Unknown platforms: return null → falls through to audio fallback

## Secrets & tooling
- `RAPIDAPI_KEY` — RapidAPI auth header `x-rapidapi-key`
- `OPENAI_API_KEY` — Whisper transcription (whisper-1, ~$0.006/min)
- yt-dlp: standalone binary installed at ~/.local/bin/yt-dlp via `curl` from GitHub releases (pip install blocked by PEP 668 on NixOS)
