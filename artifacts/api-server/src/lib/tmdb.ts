const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

interface TmdbMovie {
  id: number;
  title: string;
  release_date: string;
  poster_path: string | null;
  overview: string;
  popularity: number;
}

interface TmdbSearchResponse {
  results: TmdbMovie[];
  total_results: number;
}

export interface TmdbCandidate {
  tmdbId: number;
  title: string;
  releaseYear: string;
  posterUrl: string;
  overview: string;
}

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

export async function searchTmdb(query: string): Promise<TmdbCandidate[]> {
  const apiKey = getApiKey();
  const url = `${TMDB_BASE}/search/movie?query=${encodeURIComponent(query)}&api_key=${apiKey}&include_adult=false&language=en-US`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TMDB search failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as TmdbSearchResponse;

  return data.results
    .filter((m) => m.poster_path) // only movies with posters
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 3)
    .map((m) => ({
      tmdbId: m.id,
      title: m.title,
      releaseYear: getReleaseYear(m.release_date),
      posterUrl: getPosterUrl(m.poster_path),
      overview: m.overview ?? "",
    }));
}
