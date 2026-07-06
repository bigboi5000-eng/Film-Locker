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
}

interface TmdbSearchResponse {
  results: TmdbMovie[];
  total_results: number;
}

interface TmdbCredits {
  cast: Array<{ name: string; order: number }>;
  crew: Array<{ name: string; job: string; department: string }>;
}

interface TmdbProvidersResponse {
  results: {
    US?: {
      flatrate?: Array<{ provider_id: number; provider_name: string; logo_path: string }>;
      rent?: Array<{ provider_id: number; provider_name: string; logo_path: string }>;
      buy?: Array<{ provider_id: number; provider_name: string; logo_path: string }>;
    };
  };
}

export interface TmdbCandidate {
  tmdbId: number;
  title: string;
  releaseYear: string;
  posterUrl: string;
  overview: string;
}

export interface TmdbMovieDetails extends TmdbCandidate {
  director: string;
  cast: string[];
  genres: string[];
  language: string;
  watchProviders: WatchProvider[];
}

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

function movieToCandidate(m: TmdbMovie): TmdbCandidate {
  return {
    tmdbId: m.id,
    title: m.title,
    releaseYear: getReleaseYear(m.release_date),
    posterUrl: getPosterUrl(m.poster_path),
    overview: m.overview ?? "",
  };
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

  // US watch providers: flatrate (streaming) then rent as fallback
  let watchProviders: WatchProvider[] = [];
  if (providersResult.status === "fulfilled") {
    const us = providersResult.value.results?.US;
    const raw = [
      ...(us?.flatrate ?? []),
      ...(us?.rent ?? []),
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
      }));
  }

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
  };
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
