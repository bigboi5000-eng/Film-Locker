---
name: Film Locker schema & redesign
description: DB schema additions, TMDB enrichment pipeline rules, and 3-tab UI structure.
---

## DB schema additions (moviesTable)
director(text), cast(text[]), genres(text[]), language(text),
watchProviders(jsonb as WatchProvider[]), rating(int nullable 1-5),
isWatched(bool default false), watchedAt(timestamp nullable).

## Pipeline upsert rule (moviePipeline.ts enrichAndSaveMatches)
- If fetchMovieDetails succeeds → onConflictDoUpdate enrichment fields only
  (director, cast, genres, language, watchProviders).
- If fetchMovieDetails fails → onConflictDoNothing so existing metadata
  is never regressed to empty strings/arrays.
- rating / isWatched / watchedAt are NEVER touched in the upsert conflict set.

**Why:** User state (rating, watched) must survive re-processing the same movie.
Enrichment data should be refreshable but must not overwrite with empty fallbacks.

## 3-tab mobile structure
- Home (index.tsx): useGetTrending + useGetNewReleases horizontal scrolls
- Watchlist (watchlist.tsx): isWatched=false filter + search + paste-link + FilterBar
- Watched (watched.tsx): isWatched=true filter + FilterBar
- FilmDetailModal: always fetches useGetMovieDetails(tmdbId) for fresh TMDB data;
  savedMovie prop used only for id/rating/isWatched actions.

## TMDB new endpoints in tmdb.ts
- fetchMovieDetails(tmdbId): parallel /movie/:id + /credits + /watch/providers
  All sub-requests guarded with res.ok check before json parse.
- fetchTrending(): /trending/movie/week
- fetchNowPlaying(): /movie/now_playing?region=US

## API route ordering note
Named routes (trending, new-releases, parse-caption, ai-extract,
process-social-link, tmdb/:tmdbId) must be declared before /:id to avoid
Express param collision.
