import type { WatchProvider } from "@workspace/db";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

// ── Interfaces ────────────────────────────────────────────────────────────────

interface TmdbMovie {
  id: number;
  title: string;
  release_date: string;
  poster_path: string | null;
  overview: string;
  popularity: number;
  original_language?: string;
  genre_ids?: number[];
}

interface TmdbMovieDetail extends TmdbMovie {
  genres: Array<{ id: number; name: string }>;
  original_language: string;
  vote_average: number;
  vote_count: number;
}

interface TmdbSearchResponse {
  results: TmdbMovie[];
  total_results: number;
}

interface TmdbCredits {
  cast: Array<{ name: string; order: number }>;
  crew: Array<{ name: string; job: string; department: string }>;
}

interface TmdbProviderEntry {
  provider_id: number;
  provider_name: string;
  logo_path: string;
}

interface TmdbProvidersResponse {
  results: {
    US?: {
      link?: string;
      flatrate?: TmdbProviderEntry[];
      rent?: TmdbProviderEntry[];
      buy?: TmdbProviderEntry[];
    };
  };
}

export interface TmdbCandidate {
  tmdbId: number;
  title: string;
  releaseYear: string;
  posterUrl: string;
  overview: string;
  genres: string[];
  language?: string;
  director?: string;
  cast?: string[];
  watchProviders?: WatchProvider[];
}

export interface TmdbMovieDetails extends TmdbCandidate {
  director: string;
  cast: string[];
  genres: string[];
  language: string;
  watchProviders: WatchProvider[];
  // TMDB's own aggregate rating (0-10, from their user base) — free on the
  // same details response, distinct from Film Locker's own community
  // ratings/comments and distinct from (unavailable) IMDb/Rotten Tomatoes
  // scores, which TMDB has no access to.
  tmdbRating: number | null;
  tmdbVoteCount: number;
}

// ── Genre map (stable TMDB list — no API call needed) ─────────────────────────

const TMDB_GENRE_MAP: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy",
  80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
  14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
  9648: "Mystery", 10749: "Romance", 878: "Science Fiction",
  10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env["TMDB_API_KEY"];
  if (!key) throw new Error("TMDB_API_KEY environment variable is not set");
  return key;
}

export function getPosterUrl(posterPath: string | null): string {
  if (!posterPath) return "";
  return `${TMDB_IMAGE_BASE}${posterPath}`;
}

export function getReleaseYear(releaseDate: string): string {
  if (!releaseDate) return "";
  return releaseDate.split("-")[0] ?? "";
}

/** Full language name via Intl when possible, falling back to the raw ISO code. */
function languageName(langCode: string | undefined): string | undefined {
  if (!langCode) return undefined;
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(langCode) ?? langCode;
  } catch {
    return langCode; // Intl not available in this runtime
  }
}

function movieToCandidate(m: TmdbMovie): TmdbCandidate {
  return {
    tmdbId: m.id,
    title: m.title,
    releaseYear: getReleaseYear(m.release_date),
    posterUrl: getPosterUrl(m.poster_path),
    overview: m.overview ?? "",
    genres: (m.genre_ids ?? []).map((id) => TMDB_GENRE_MAP[id]).filter(Boolean) as string[],
    language: languageName(m.original_language),
  };
}

/**
 * Fills in director/cast/watchProviders for a list of candidates (genre and
 * language are already free on the list response — see movieToCandidate).
 * Used for discovery lists (trending, new releases, recommendations) so the
 * Director/Actor/Streaming filters on those screens have real options
 * instead of always showing "No data yet". Runs one credits + one
 * watch-providers request per movie, all in parallel; a single movie's
 * failure just leaves that movie's fields empty rather than failing the list.
 */
export async function enrichCandidates(candidates: TmdbCandidate[]): Promise<TmdbCandidate[]> {
  const apiKey = getApiKey();
  const okJson = async <T>(res: Response): Promise<T> => {
    if (!res.ok) throw new Error(`TMDB ${res.url} → ${res.status} ${res.statusText}`);
    return res.json() as Promise<T>;
  };

  return Promise.all(
    candidates.map(async (c) => {
      const [creditsResult, providersResult] = await Promise.allSettled([
        fetch(`${TMDB_BASE}/movie/${c.tmdbId}/credits?api_key=${apiKey}&language=en-US`).then((r) =>
          okJson<TmdbCredits>(r)
        ),
        fetch(`${TMDB_BASE}/movie/${c.tmdbId}/watch/providers?api_key=${apiKey}`).then((r) =>
          okJson<TmdbProvidersResponse>(r)
        ),
      ]);

      let director: string | undefined;
      let cast: string[] | undefined;
      if (creditsResult.status === "fulfilled") {
        director = creditsResult.value.crew.find((cr) => cr.job === "Director")?.name;
        cast = creditsResult.value.cast
          .sort((a, b) => a.order - b.order)
          .slice(0, 10)
          .map((cr) => cr.name);
      }

      let watchProviders: WatchProvider[] | undefined;
      if (providersResult.status === "fulfilled") {
        const us = providersResult.value.results?.US;
        const juswatchLink = us?.link;
        type TypedEntry = TmdbProviderEntry & { _type: WatchProvider["type"] };
        const raw: TypedEntry[] = [
          ...(us?.flatrate ?? []).map((p) => ({ ...p, _type: "flatrate" as const })),
          ...(us?.rent ?? []).map((p) => ({ ...p, _type: "rent" as const })),
          ...(us?.buy ?? []).map((p) => ({ ...p, _type: "buy" as const })),
        ];
        const seen = new Set<number>();
        watchProviders = raw
          .filter((p) => {
            if (seen.has(p.provider_id)) return false;
            seen.add(p.provider_id);
            return true;
          })
          .map((p) => ({
            provider_id: p.provider_id,
            provider_name: p.provider_name,
            logo_url: getPosterUrl(p.logo_path),
            type: p._type,
            ...(juswatchLink ? { link: juswatchLink } : {}),
          }));
      }

      return { ...c, director, cast, watchProviders };
    })
  );
}

// ── Search ────────────────────────────────────────────────────────────────────

export async function searchTmdb(query: string): Promise<TmdbCandidate[]> {
  const apiKey = getApiKey();
  const url = `${TMDB_BASE}/search/movie?query=${encodeURIComponent(query)}&api_key=${apiKey}&include_adult=false&language=en-US`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TMDB search failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as TmdbSearchResponse;

  return data.results
    .filter((m) => m.poster_path)
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 3)
    .map(movieToCandidate);
}

// ── Full details (credits + watch providers) ──────────────────────────────────

/**
 * Fetch full movie details from TMDB including director, top cast,
 * genre names, original language, and US streaming watch providers.
 *
 * All three sub-requests run in parallel. Individual failures are
 * tolerated — the result falls back to empty values for that field.
 */
export async function fetchMovieDetails(
  tmdbId: number
): Promise<TmdbMovieDetails | null> {
  const apiKey = getApiKey();

  const okJson = async <T>(res: Response): Promise<T> => {
    if (!res.ok) throw new Error(`TMDB ${res.url} → ${res.status} ${res.statusText}`);
    return res.json() as Promise<T>;
  };

  const [detailsResult, creditsResult, providersResult] =
    await Promise.allSettled([
      fetch(`${TMDB_BASE}/movie/${tmdbId}?api_key=${apiKey}&language=en-US`).then((r) =>
        okJson<TmdbMovieDetail>(r)
      ),
      fetch(`${TMDB_BASE}/movie/${tmdbId}/credits?api_key=${apiKey}&language=en-US`).then((r) =>
        okJson<TmdbCredits>(r)
      ),
      fetch(`${TMDB_BASE}/movie/${tmdbId}/watch/providers?api_key=${apiKey}`).then((r) =>
        okJson<TmdbProvidersResponse>(r)
      ),
    ]);

  if (detailsResult.status === "rejected") return null;

  const details = detailsResult.value;

  // Director — first crew member with job "Director"
  let director = "";
  if (creditsResult.status === "fulfilled") {
    director =
      creditsResult.value.crew.find((c) => c.job === "Director")?.name ?? "";
  }

  // Top 10 cast members by billing order
  let cast: string[] = [];
  if (creditsResult.status === "fulfilled") {
    cast = creditsResult.value.cast
      .sort((a, b) => a.order - b.order)
      .slice(0, 10)
      .map((c) => c.name);
  }

  // Genre names
  const genres = (details.genres ?? []).map((g) => g.name);

  // Language (full name via Intl when possible, fallback to ISO code)
  const langCode = details.original_language ?? "";
  let language = langCode;
  try {
    language =
      new Intl.DisplayNames(["en"], { type: "language" }).of(langCode) ??
      langCode;
  } catch {
    /* Intl not available in this runtime — use raw code */
  }

  // US watch providers: flatrate (subscription) → rent → buy, preserving type
  let watchProviders: WatchProvider[] = [];
  if (providersResult.status === "fulfilled") {
    const us = providersResult.value.results?.US;
    const juswatchLink = us?.link;

    type TypedEntry = TmdbProviderEntry & { _type: WatchProvider['type'] };
    const raw: TypedEntry[] = [
      ...(us?.flatrate ?? []).map((p) => ({ ...p, _type: 'flatrate' as const })),
      ...(us?.rent ?? []).map((p) => ({ ...p, _type: 'rent' as const })),
      ...(us?.buy ?? []).map((p) => ({ ...p, _type: 'buy' as const })),
    ];

    const seen = new Set<number>();
    watchProviders = raw
      .filter((p) => {
        if (seen.has(p.provider_id)) return false;
        seen.add(p.provider_id);
        return true;
      })
      .map((p) => ({
        provider_id: p.provider_id,
        provider_name: p.provider_name,
        logo_url: getPosterUrl(p.logo_path),
        type: p._type,
        ...(juswatchLink ? { link: juswatchLink } : {}),
      }));
  }

  // TMDB's own aggregate rating (their user base's average vote) — already
  // on this same details response, no extra request needed. Treat a
  // zero-vote film as "no rating" rather than a literal 0/10.
  const tmdbRating = details.vote_count > 0 ? Math.round(details.vote_average * 10) / 10 : null;
  const tmdbVoteCount = details.vote_count ?? 0;

  return {
    tmdbId: details.id,
    title: details.title,
    releaseYear: getReleaseYear(details.release_date),
    posterUrl: getPosterUrl(details.poster_path),
    overview: details.overview ?? "",
    director,
    cast,
    genres,
    language,
    watchProviders,
    tmdbRating,
    tmdbVoteCount,
  };
}

/**
 * Search TMDB by title for the UI — returns up to 20 poster-bearing results
 * sorted by popularity. Distinct from `searchTmdb` which caps at 3 for the
 * AI pipeline.
 */
export async function searchMoviesUI(query: string): Promise<TmdbCandidate[]> {
  const apiKey = getApiKey();
  const url = `${TMDB_BASE}/search/movie?query=${encodeURIComponent(query)}&api_key=${apiKey}&include_adult=false&language=en-US&page=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB search failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as TmdbSearchResponse;
  return data.results
    .filter((m) => m.poster_path)
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 20)
    .map(movieToCandidate);
}

// ── Discovery (home screen) ───────────────────────────────────────────────────

export async function fetchTrending(): Promise<TmdbCandidate[]> {
  const apiKey = getApiKey();
  const res = await fetch(
    `${TMDB_BASE}/trending/movie/week?api_key=${apiKey}&language=en-US`
  );
  if (!res.ok) throw new Error(`TMDB trending failed: ${res.status}`);
  const data = (await res.json()) as TmdbSearchResponse;
  return data.results
    .filter((m) => m.poster_path)
    .slice(0, 20)
    .map(movieToCandidate);
}

export async function fetchNowPlaying(): Promise<TmdbCandidate[]> {
  const apiKey = getApiKey();
  const res = await fetch(
    `${TMDB_BASE}/movie/now_playing?api_key=${apiKey}&language=en-US&region=US`
  );
  if (!res.ok) throw new Error(`TMDB now_playing failed: ${res.status}`);
  const data = (await res.json()) as TmdbSearchResponse;
  return data.results
    .filter((m) => m.poster_path)
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 20)
    .map(movieToCandidate);
}

/**
 * Fetch TMDB recommendations for a given movie (the "More like this" list).
 * Returns up to 20 poster-bearing results sorted by popularity.
 */
export async function fetchTmdbRecommendations(
  tmdbId: number
): Promise<TmdbCandidate[]> {
  const apiKey = getApiKey();
  const res = await fetch(
    `${TMDB_BASE}/movie/${tmdbId}/recommendations?api_key=${apiKey}&language=en-US&page=1`
  );
  if (!res.ok) {
    // A 404 here just means TMDB doesn't know this ID — treat as empty
    if (res.status === 404) return [];
    throw new Error(`TMDB recommendations failed for ${tmdbId}: ${res.status}`);
  }
  const data = (await res.json()) as TmdbSearchResponse;
  return data.results
    .filter((m) => m.poster_path)
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 20)
    .map(movieToCandidate);
}
