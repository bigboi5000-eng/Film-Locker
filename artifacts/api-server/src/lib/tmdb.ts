import type { WatchProvider } from "@workspace/db";
import { cached } from "./cache";
import { logger } from "./logger";

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
  /**
   * Minutes. TMDB returns null for films it has no runtime for (common for
   * very obscure or unreleased titles) and, less obviously, `0` for some
   * entries where the field exists but was never filled in — both mean
   * "unknown", so treat them the same.
   */
  runtime: number | null;
}

interface TmdbSearchResponse {
  results: TmdbMovie[];
  total_results: number;
}

/**
 * Film or series.
 *
 * TMDB mirrors almost every endpoint between /movie and /tv, with the same
 * shapes under different field names — `title`/`name`,
 * `release_date`/`first_air_date`, `runtime`/`episode_run_time`. So rather
 * than a second copy of this module, the path segment and the field
 * mapping are parameterised and everything else is shared.
 */
export type MediaType = "movie" | "tv";

/**
 * A series as TMDB returns it, in the places the shapes diverge.
 *
 * Only the fields that differ are listed; the rest are identical to a
 * film's and are read through the shared mapper.
 */
interface TmdbTvDetail {
  id: number;
  name: string;
  first_air_date: string;
  poster_path: string | null;
  overview?: string;
  genres: Array<{ id: number; name: string }>;
  original_language: string;
  vote_average: number;
  vote_count: number;
  /**
   * Minutes PER EPISODE, and an array because a series can have several
   * typical lengths (a 60-minute drama with 90-minute specials). TMDB
   * returns an empty array for plenty of series.
   *
   * Deliberately not written to movies.runtime: that column means "how
   * long is this thing", which for a series is a question about an episode
   * and not about the series. Filtering by it would compare a film's whole
   * length against one episode of a show. See the Kind filter, which hides
   * the runtime slider for TV.
   */
  episode_run_time?: number[];
  /** A series has creators where a film has a director. */
  created_by?: Array<{ id: number; name: string }>;
  number_of_seasons?: number;
  number_of_episodes?: number;
}

interface TmdbTvListItem {
  id: number;
  name: string;
  first_air_date?: string;
  poster_path: string | null;
  overview?: string;
  genre_ids?: number[];
  original_language?: string;
  popularity: number;
}

interface TmdbCredits {
  cast: Array<{ id: number; name: string; order: number }>;
  crew: Array<{ id: number; name: string; job: string; department: string }>;
}

/** A named person on a film, with the id needed to open their filmography. */
export interface TmdbPersonRef {
  id: number;
  name: string;
}

interface TmdbProviderEntry {
  provider_id: number;
  provider_name: string;
  logo_path: string;
}

interface TmdbProvidersResponse {
  // Keyed by every country TMDB/JustWatch has data for in one response —
  // no region query param on this endpoint, you just pick the country key.
  results: Record<
    string,
    {
      link?: string;
      flatrate?: TmdbProviderEntry[];
      rent?: TmdbProviderEntry[];
      buy?: TmdbProviderEntry[];
    }
  >;
}

/** Default region when the caller doesn't specify one. */
export const DEFAULT_REGION = "US";

/**
 * Read a kind off a query string or a database row.
 *
 * Anything that is not the literal "tv" is a film. That covers the three
 * cases that matter and treats them identically, which is the point: a
 * column default written before TV existed, an app build that does not
 * send the parameter, and junk. None of them should 400 — a film is what
 * every one of them meant.
 */
export function normalizeMediaType(input: unknown): MediaType {
  return input === "tv" ? "tv" : "movie";
}

/** Loose sanitization — just enough to avoid passing junk through to TMDB. */
export function normalizeRegion(input: unknown): string {
  const s = typeof input === "string" ? input.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(s) ? s : DEFAULT_REGION;
}

export interface TmdbCandidate {
  tmdbId: number;
  /**
   * Film or series. Required, not optional with a default, because TMDB
   * numbers the two separately — film 1399 and series 1399 are different
   * things — so a candidate without it is not identifiable, and a default
   * would quietly make every series a film.
   */
  mediaType: MediaType;
  title: string;
  releaseYear: string;
  posterUrl: string;
  overview: string;
  genres: string[];
  language?: string;
  director?: string;
  cast?: string[];
  /**
   * The same director and cast, with TMDB's person ids, so a name on screen
   * can open that person's filmography. Added alongside the plain-string
   * fields rather than replacing them: those are what the movies table
   * stores and what every existing screen reads.
   */
  directorRef?: TmdbPersonRef | null;
  castRefs?: TmdbPersonRef[];
  watchProviders?: WatchProvider[];
  /**
   * Minutes. Absent on TMDB's list responses, so it is only populated by
   * enrichCandidates; null means TMDB has no runtime for the film.
   */
  runtime?: number | null;
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
  /** Running time in minutes, or null when TMDB has no runtime for the film. */
  runtime: number | null;
  /**
   * True when credits or watch providers did not come back.
   *
   * Only here to keep a half-answer out of the cache. An empty cast and a
   * cast that failed to arrive are the same empty array to everyone
   * downstream, so without this flag a film fetched during a throttle was
   * remembered as castless for the full half-hour TTL — which is why the
   * data "came in fine for a minute and then went", and then stayed gone.
   * Stripped from the HTTP response by the schema, which does not know it.
   */
  degraded?: boolean;
}

// ── Genre map (stable TMDB list — no API call needed) ─────────────────────────

const TMDB_GENRE_MAP: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy",
  80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
  14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
  9648: "Mystery", 10749: "Romance", 878: "Science Fiction",
  10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
};

/**
 * TMDB keeps a SEPARATE genre list for television, and the ids overlap.
 *
 * Eight ids mean the same thing in both lists (Comedy 35, Drama 18 and so
 * on), but the rest do not: 10759 is "Action & Adventure" and exists only
 * for TV, while 28 "Action" and 878 "Science Fiction" exist only for film.
 * Reading a series' genre_ids through the film map therefore does not fail
 * loudly — it drops the TV-only ids and keeps the shared ones, so a
 * sci-fi series comes back tagged only "Drama". Hence two maps.
 */
const TMDB_TV_GENRE_MAP: Record<number, string> = {
  10759: "Action & Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 10762: "Kids",
  9648: "Mystery", 10763: "News", 10764: "Reality",
  10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk",
  10768: "War & Politics", 37: "Western",
};

function genreNames(ids: number[] | undefined, mediaType: MediaType): string[] {
  const map = mediaType === "tv" ? TMDB_TV_GENRE_MAP : TMDB_GENRE_MAP;
  return (ids ?? []).map((id) => map[id]).filter(Boolean) as string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * A TMDB request that retries a throttle instead of losing the field.
 *
 * TMDB answers a burst with 429, and a burst is the normal case here: one
 * film detail is three requests, and enriching a twenty-film discovery rail
 * is sixty. Every one of those that comes back 429 used to be a silently
 * missing cast list.
 *
 * Only 429 and 5xx are retried — a 401 or a 404 is a settled answer and
 * asking again just spends another request on the same reply. Retry-After
 * is honoured where TMDB sends it, capped so one unlucky call cannot hold a
 * request open for a minute.
 */
async function tmdbFetch(url: string, attempt = 0): Promise<Response> {
  const res = await fetch(url);
  if (res.ok) return res;

  const retryable = res.status === 429 || res.status >= 500;
  if (!retryable || attempt >= 2) return res;

  const header = Number(res.headers.get("retry-after"));
  const waitMs = Number.isFinite(header) && header > 0
    ? Math.min(header * 1000, 3000)
    : 400 * 2 ** attempt;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  return tmdbFetch(url, attempt + 1);
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

/** Full language name via Intl when possible, falling back to the raw ISO code. */
function languageName(langCode: string | undefined): string | undefined {
  if (!langCode) return undefined;
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(langCode) ?? langCode;
  } catch {
    return langCode; // Intl not available in this runtime
  }
}

/**
 * One entry of a TMDB list response — a search page, a trending page, a
 * recommendations page — as either kind.
 *
 * The caller always knows which kind it asked for, because the kind is in
 * the URL it requested; nothing here infers it from the payload.
 */
function movieToCandidate(
  m: TmdbMovie | TmdbTvListItem,
  mediaType: MediaType = "movie",
): TmdbCandidate {
  const title = mediaType === "tv" ? (m as TmdbTvListItem).name : (m as TmdbMovie).title;
  const date =
    mediaType === "tv" ? (m as TmdbTvListItem).first_air_date : (m as TmdbMovie).release_date;

  return {
    tmdbId: m.id,
    mediaType,
    title: title ?? "",
    releaseYear: getReleaseYear(date ?? ""),
    posterUrl: getPosterUrl(m.poster_path),
    overview: m.overview ?? "",
    genres: genreNames(m.genre_ids, mediaType),
    language: languageName(m.original_language),
  };
}

/**
 * Fills in director/cast/watchProviders/runtime for a list of candidates
 * (genre and language are already free on the list response — see
 * movieToCandidate). Used for discovery lists (trending, new releases,
 * recommendations) so the Genre/Director/Actor/Streaming/Length filters on
 * those screens have real options instead of always showing "No data yet".
 *
 * Runs one credits + one watch-providers + one details request per movie, all
 * in parallel; a single movie's failure just leaves that movie's fields empty
 * rather than failing the list. The details request is the one that carries
 * runtime, and it goes through the cached fetchMovieDetails rather than a raw
 * fetch — a film that appears in both trending and new releases, or that the
 * same user opens afterwards, costs nothing the second time.
 */
export async function enrichCandidates(
  candidates: TmdbCandidate[],
  region: string = DEFAULT_REGION
): Promise<TmdbCandidate[]> {
  const apiKey = getApiKey();
  const okJson = async <T>(res: Response): Promise<T> => {
    if (!res.ok) throw new Error(`TMDB ${res.url} → ${res.status} ${res.statusText}`);
    return res.json() as Promise<T>;
  };

  return Promise.all(
    candidates.map(async (c) => {
      // A series needs no extra requests here. fetchMovieDetails already
      // fetches its detail, credits and providers together and caches the
      // lot, and unlike a film its "director" comes off the detail
      // response (created_by) rather than the credits crew — so going
      // through it is both cheaper and the only way to get the creators.
      if (c.mediaType === "tv") {
        const details = await fetchMovieDetails(c.tmdbId, region, "tv").catch((err) => {
          logger.warn({ tmdbId: c.tmdbId, err: String(err) }, "TMDB enrich failed for series");
          return null;
        });
        if (!details) return c;
        return {
          ...c,
          director: details.director || undefined,
          cast: details.cast.length > 0 ? details.cast : undefined,
          watchProviders: details.watchProviders,
          runtime: null,
        };
      }

      const [creditsResult, providersResult, detailsResult] = await Promise.allSettled([
        tmdbFetch(`${TMDB_BASE}/movie/${c.tmdbId}/credits?api_key=${apiKey}&language=en-US`).then((r) =>
          okJson<TmdbCredits>(r)
        ),
        tmdbFetch(`${TMDB_BASE}/movie/${c.tmdbId}/watch/providers?api_key=${apiKey}`).then((r) =>
          okJson<TmdbProvidersResponse>(r)
        ),
        fetchMovieDetails(c.tmdbId, region),
      ]);

      if (creditsResult.status === "rejected" || providersResult.status === "rejected") {
        logger.warn(
          {
            tmdbId: c.tmdbId,
            credits: creditsResult.status === "rejected" ? String(creditsResult.reason) : "ok",
            providers: providersResult.status === "rejected" ? String(providersResult.reason) : "ok",
          },
          "TMDB enrich partially failed — cast or providers missing",
        );
      }

      const runtime =
        detailsResult.status === "fulfilled" ? detailsResult.value?.runtime ?? null : null;

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
        const us = providersResult.value.results?.[region];
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

      return { ...c, director, cast, watchProviders, runtime };
    })
  );
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * A title's search results barely move, and the same handful of films get
 * looked up over and over — across users sharing the same viral post, and
 * within a single share when the identify step and the save step both run.
 * An hour is long enough to collapse all of that and short enough that a
 * newly-added film shows up the same session.
 */
const SEARCH_CACHE_TTL_MS = 60 * 60 * 1000;

/** A plausible four-digit release year, or null for anything else. */
function parseYear(year: string | undefined): string | null {
  if (!year) return null;
  const trimmed = year.trim();
  if (!/^\d{4}$/.test(trimmed)) return null;
  // Guard against a hallucinated 0202 or 9999 narrowing the search to nothing.
  const n = Number(trimmed);
  if (n < 1880 || n > new Date().getFullYear() + 5) return null;
  return trimmed;
}

/**
 * Search TMDB for a title, optionally narrowed to a release year.
 *
 * `year` matters more than it looks. Without it this ranked candidates by
 * TMDB's `popularity`, which is a measure of how much attention a film is
 * getting — and a film released this week has almost none. Any older film
 * with a similar title outranked it, so the newest releases, the ones people
 * are most likely to be sharing a post about, were the ones most likely to
 * resolve to the wrong film. Gemini already returns a release year for every
 * match; it simply was not being passed through to here.
 *
 * When a year is supplied, TMDB's own relevance order is kept rather than
 * re-sorted: the year has already done the disambiguating, and popularity
 * would only reintroduce the same bias among the remaining candidates.
 * Without a year, popularity is still the best tie-break available.
 */
export async function searchTmdb(
  query: string,
  year?: string,
  mediaType: MediaType = "movie",
): Promise<TmdbCandidate[]> {
  const normalised = query.trim().toLowerCase();
  if (!normalised) return [];

  const releaseYear = parseYear(year);

  return cached(
    // The year and the kind are both part of the key: the same title
    // searched with and without a year is a different query, and searched
    // as a film and as a series it is two different titles.
    `tmdb:search:${mediaType}:${normalised}${releaseYear ? `:${releaseYear}` : ""}`,
    SEARCH_CACHE_TTL_MS,
    async () => {
      const apiKey = getApiKey();
      // The year parameter is named differently on the two endpoints, and
      // the wrong name is silently IGNORED by TMDB rather than rejected —
      // so a series search with primary_release_year would quietly stop
      // disambiguating and go back to losing new titles to popular old
      // ones, with nothing in the logs to say so.
      const yearParam = releaseYear
        ? mediaType === "tv"
          ? `&first_air_date_year=${releaseYear}`
          : `&primary_release_year=${releaseYear}`
        : "";
      const url = `${TMDB_BASE}/search/${mediaType}?query=${encodeURIComponent(query)}&api_key=${apiKey}${yearParam}&include_adult=false&language=en-US`;

      const res = await tmdbFetch(url);
      if (!res.ok) {
        throw new Error(`TMDB search failed: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as {
        results: Array<(TmdbMovie | TmdbTvListItem) & { popularity: number }>;
      };

      // Prefer results with artwork, since the UI shows a poster card — but
      // do not let that discard the film entirely. TMDB indexes a new release
      // days before anyone uploads a poster for it, which is exactly the case
      // this function was getting wrong.
      const withPoster = data.results.filter((m) => m.poster_path);
      const candidates = withPoster.length > 0 ? withPoster : data.results;

      const ordered = releaseYear
        ? candidates
        : [...candidates].sort((a, b) => b.popularity - a.popularity);

      return ordered.slice(0, 3).map((m) => movieToCandidate(m, mediaType));
    },
    // Never remember a miss: a film TMDB hasn't indexed yet, or a title
    // Gemini garbled, would otherwise stay "not found" for the full hour
    // even after a retry would have worked.
    { shouldCache: (results) => results.length > 0 },
  );
}

/**
 * Search narrowed to `year`, falling back to an unnarrowed search when that
 * finds nothing.
 *
 * The year comes from Gemini reading a caption, so it is frequently right and
 * occasionally a year out — a post about a film's streaming debut naming the
 * year it reached the platform rather than the year it was released, say.
 * Narrowing is worth it for the accuracy it buys on new releases, but it must
 * never be the reason a film that TMDB holds comes back as unidentified.
 */
export async function searchTmdbPreferringYear(
  query: string,
  year?: string,
  mediaType: MediaType = "movie",
): Promise<TmdbCandidate[]> {
  if (parseYear(year)) {
    const narrowed = await searchTmdb(query, year, mediaType);
    if (narrowed.length > 0) return narrowed;
  }
  return searchTmdb(query, undefined, mediaType);
}

// ── Television, only so it can be ruled out ───────────────────────────────────

/** A television series TMDB holds, matched by title. */
export type TmdbTvMatch = {
  id: number;
  name: string;
  /** Four-digit first-air year, or an empty string when TMDB has no date. */
  firstAirYear: string;
};

interface TmdbTvSearchResponse {
  results: Array<{
    id: number;
    name: string;
    first_air_date: string | null;
    popularity: number;
  }>;
}

/**
 * Look a title up as a television series.
 *
 * Film Locker is a film catalogue and television is deliberately out of
 * scope, so this exists to explain a failure rather than to widen what can
 * be saved. A clip from a miniseries is posted by the same accounts, worded
 * the same way, and the pipeline reads its title perfectly well — it then
 * finds no film of that name and says nothing, which is indistinguishable
 * from having failed to read the post at all.
 *
 * "Houdini (2014)" is the case that prompted it: a History Channel
 * miniseries whose caption names it outright. Gemini scores it low because
 * the prompt tells it to exclude television, the film search finds nothing,
 * and the user is shown an empty sheet. Knowing it is a series turns that
 * into an answer.
 *
 * Returns the most popular match, or null. The year narrows when TMDB has
 * one, and is never the reason a series goes unfound — same reasoning as
 * searchTmdbPreferringYear.
 */
export async function searchTmdbTv(query: string, year?: string): Promise<TmdbTvMatch | null> {
  const normalised = query.trim().toLowerCase();
  if (!normalised) return null;

  const airYear = parseYear(year);

  return cached(
    `tmdb:search:tv:${normalised}${airYear ? `:${airYear}` : ""}`,
    SEARCH_CACHE_TTL_MS,
    async () => {
      const apiKey = getApiKey();

      const run = async (withYear: boolean): Promise<TmdbTvMatch | null> => {
        const yearParam = withYear && airYear ? `&first_air_date_year=${airYear}` : "";
        const res = await fetch(
          `${TMDB_BASE}/search/tv?query=${encodeURIComponent(query)}` +
            `&api_key=${apiKey}${yearParam}&include_adult=false&language=en-US`,
        );
        if (!res.ok) {
          throw new Error(`TMDB TV search failed: ${res.status} ${res.statusText}`);
        }

        const data = (await res.json()) as TmdbTvSearchResponse;
        const best = [...data.results].sort((a, b) => b.popularity - a.popularity)[0];
        if (!best) return null;

        return {
          id: best.id,
          name: best.name,
          firstAirYear: best.first_air_date?.slice(0, 4) ?? "",
        };
      };

      if (airYear) {
        const narrowed = await run(true);
        if (narrowed) return narrowed;
      }
      return run(false);
    },
    // A miss is not remembered, for the same reason the film search does not
    // remember one: a series TMDB indexes later would otherwise stay unfound
    // for the rest of the hour.
    { shouldCache: (match) => match !== null },
  );
}

// ── Full details (credits + watch providers) ──────────────────────────────────

/**
 * Fetch full movie details from TMDB including director, top cast, genre
 * names, original language, and streaming watch providers for `region`
 * (defaults to US — TMDB/JustWatch track availability per country, so a
 * film's US streaming lineup can be completely different from its UK one).
 *
 * All three sub-requests run in parallel. Individual failures are
 * tolerated — the result falls back to empty values for that field.
 */
export async function fetchMovieDetails(
  tmdbId: number,
  region: string = DEFAULT_REGION,
  mediaType: MediaType = "movie",
): Promise<TmdbMovieDetails | null> {
  // Three upstream requests per call, and the same films recur constantly —
  // a shared post identified by several users, or one list mentioning a film
  // twice. Cached per region since watch providers differ by country.
  // Neither a null (the details request itself failing) nor a half answer
  // is cached, so a blip doesn't stick. The half answer is the one that
  // bit: details succeeding while credits and providers were throttled
  // gave a perfectly valid-looking film with no cast and nothing to watch
  // it on, and caching that pinned the gap in place for thirty minutes
  // after TMDB had recovered.
  // The kind is part of the key and cannot be left out: TMDB numbers films
  // and series separately, so 1399 is Star Trek: First Contact as a film
  // and Game of Thrones as a series. A shared key would serve whichever was
  // asked for first.
  return cached(
    `tmdb:details:${mediaType}:${tmdbId}:${region}`,
    DETAILS_CACHE_TTL_MS,
    () => fetchMovieDetailsUncached(tmdbId, region, mediaType),
    { shouldCache: (result) => result !== null && !result.degraded },
  );
}

/**
 * Watch providers are the part of this payload that actually changes (a film
 * leaving Netflix), so this is shorter than the search TTL.
 */
const DETAILS_CACHE_TTL_MS = 30 * 60 * 1000;

async function fetchMovieDetailsUncached(
  tmdbId: number,
  region: string,
  mediaType: MediaType = "movie",
): Promise<TmdbMovieDetails | null> {
  const apiKey = getApiKey();

  const okJson = async <T>(res: Response): Promise<T> => {
    if (!res.ok) throw new Error(`TMDB ${res.url} → ${res.status} ${res.statusText}`);
    return res.json() as Promise<T>;
  };

  // /movie/{id} and /tv/{id} mirror each other all the way down, credits and
  // watch providers included, so only the path segment changes.
  const [detailsResult, creditsResult, providersResult] =
    await Promise.allSettled([
      tmdbFetch(`${TMDB_BASE}/${mediaType}/${tmdbId}?api_key=${apiKey}&language=en-US`).then((r) =>
        okJson<TmdbMovieDetail | TmdbTvDetail>(r)
      ),
      tmdbFetch(`${TMDB_BASE}/${mediaType}/${tmdbId}/credits?api_key=${apiKey}&language=en-US`).then((r) =>
        okJson<TmdbCredits>(r)
      ),
      tmdbFetch(`${TMDB_BASE}/${mediaType}/${tmdbId}/watch/providers?api_key=${apiKey}`).then((r) =>
        okJson<TmdbProvidersResponse>(r)
      ),
    ]);

  if (detailsResult.status === "rejected") return null;

  // Said out loud, because it never was. A rejected credits or providers
  // call was read only as `status !== "fulfilled"` and the field quietly
  // came back empty, so a throttled TMDB looked exactly like a film with no
  // cast — in the logs, in the response, and on the screen.
  const degraded =
    creditsResult.status === "rejected" || providersResult.status === "rejected";
  if (degraded) {
    logger.warn(
      {
        tmdbId,
        region,
        credits: creditsResult.status === "rejected" ? String(creditsResult.reason) : "ok",
        providers: providersResult.status === "rejected" ? String(providersResult.reason) : "ok",
      },
      "TMDB detail partially failed — cast or providers missing",
    );
  }

  const details = detailsResult.value;
  const isTv = mediaType === "tv";
  const asTv = details as TmdbTvDetail;
  const asFilm = details as TmdbMovieDetail;

  // Who made it. A film has one director in the credits crew; a series has
  // creators, which TMDB puts on the detail response and NOT in the crew
  // (a series' credits crew is producers and the odd writer, with no
  // "Director" job on it at all — read that way every series would come
  // back uncredited).
  //
  // Several creators are joined into the one string because `movies.director`
  // is a single column and every screen renders it as one line. directorRef
  // keeps the first, since a tap has to go to one person's page.
  let director = "";
  let directorRef: TmdbPersonRef | null = null;
  if (isTv) {
    const creators = asTv.created_by ?? [];
    director = creators.map((c) => c.name).join(", ");
    const first = creators[0];
    directorRef = first ? { id: first.id, name: first.name } : null;
  } else if (creditsResult.status === "fulfilled") {
    const found = creditsResult.value.crew.find((c) => c.job === "Director");
    director = found?.name ?? "";
    directorRef = found ? { id: found.id, name: found.name } : null;
  }

  // Top 10 cast members by billing order
  let cast: string[] = [];
  let castRefs: TmdbPersonRef[] = [];
  if (creditsResult.status === "fulfilled") {
    const top = creditsResult.value.cast.sort((a, b) => a.order - b.order).slice(0, 10);
    cast = top.map((c) => c.name);
    castRefs = top.map((c) => ({ id: c.id, name: c.name }));
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

  // Watch providers for `region`: flatrate (subscription) → rent → buy, preserving type
  let watchProviders: WatchProvider[] = [];
  if (providersResult.status === "fulfilled") {
    const us = providersResult.value.results?.[region];
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

  // TMDB uses both null and 0 for "we don't know the runtime"; neither is a
  // real length, so both become null rather than being rendered as "0m".
  //
  // Always null for a series. TMDB's episode_run_time is minutes per
  // EPISODE, which is not the same question — putting it here would have
  // the Length filter compare a two-hour film against a forty-minute
  // episode of a sixty-hour show, and have the detail screen claim a
  // series is 40m long. The Kind filter hides the Length slider for TV
  // for the same reason.
  const runtime =
    !isTv && typeof asFilm.runtime === "number" && asFilm.runtime > 0 ? asFilm.runtime : null;

  return {
    tmdbId: details.id,
    mediaType,
    title: (isTv ? asTv.name : asFilm.title) ?? "",
    releaseYear: getReleaseYear((isTv ? asTv.first_air_date : asFilm.release_date) ?? ""),
    posterUrl: getPosterUrl(details.poster_path),
    overview: details.overview ?? "",
    director,
    cast,
    directorRef,
    castRefs,
    genres,
    language,
    watchProviders,
    degraded,
    tmdbRating,
    tmdbVoteCount,
    runtime,
  };
}

/**
 * Search TMDB by title for the UI — films and series together, up to 20
 * poster-bearing results sorted by popularity. Distinct from `searchTmdb`
 * which caps at 3 and is films-only, for the AI pipeline.
 *
 * Deliberately one merged list rather than two sections. A title is
 * usually one or the other, and the person typing "Fargo" wants whichever
 * they meant without first having to say which kind it is. Popularity
 * across both is the ranking, so the Coen film outranks the series on
 * "Fargo" and "Chernobyl" returns the series, which is the only thing of
 * that name.
 *
 * A failure of one kind does not fail the other: searching while TMDB is
 * throttling should return the films it did give us, not nothing.
 */
export async function searchMoviesUI(query: string): Promise<TmdbCandidate[]> {
  const apiKey = getApiKey();
  const q = encodeURIComponent(query);

  const [films, series] = await Promise.allSettled([
    tmdbFetch(
      `${TMDB_BASE}/search/movie?query=${q}&api_key=${apiKey}&include_adult=false&language=en-US&page=1`,
    ),
    tmdbFetch(
      `${TMDB_BASE}/search/tv?query=${q}&api_key=${apiKey}&include_adult=false&language=en-US&page=1`,
    ),
  ]);

  const read = async (
    settled: PromiseSettledResult<Response>,
    mediaType: MediaType,
  ): Promise<Array<TmdbCandidate & { popularity: number }>> => {
    if (settled.status === "rejected" || !settled.value.ok) {
      logger.warn(
        {
          mediaType,
          reason:
            settled.status === "rejected" ? String(settled.reason) : settled.value.status,
        },
        "TMDB UI search failed for one kind",
      );
      return [];
    }
    const data = (await settled.value.json()) as {
      results: Array<(TmdbMovie | TmdbTvListItem) & { popularity: number }>;
    };
    return data.results
      .filter((m) => m.poster_path)
      .map((m) => ({ ...movieToCandidate(m, mediaType), popularity: m.popularity }));
  };

  const merged = [...(await read(films, "movie")), ...(await read(series, "tv"))];
  if (merged.length === 0 && films.status === "fulfilled" && !films.value.ok) {
    throw new Error(`TMDB search failed: ${films.value.status} ${films.value.statusText}`);
  }

  return merged
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 20)
    .map(({ popularity: _popularity, ...c }) => c);
}

// ── Discovery (home screen) ───────────────────────────────────────────────────

/**
 * What is trending this week, films and series together.
 *
 * `/trending/all/week` rather than one call per kind: TMDB ranks the two
 * against each other on this endpoint and tags every row with its
 * media_type, so the ordering is its own rather than something invented
 * here by interleaving two lists. It also returns `person` rows, which are
 * not something that can go in a locker and are dropped.
 *
 * This is the one place a media_type is read off the payload instead of
 * being known from the URL, because here it genuinely is the payload that
 * decides.
 */
export async function fetchTrending(): Promise<TmdbCandidate[]> {
  const apiKey = getApiKey();
  const res = await tmdbFetch(
    `${TMDB_BASE}/trending/all/week?api_key=${apiKey}&language=en-US`
  );
  if (!res.ok) throw new Error(`TMDB trending failed: ${res.status}`);
  const data = (await res.json()) as {
    results: Array<(TmdbMovie | TmdbTvListItem) & { media_type?: string }>;
  };
  return data.results
    .filter((m) => m.poster_path && (m.media_type === "movie" || m.media_type === "tv"))
    .slice(0, 20)
    .map((m) => movieToCandidate(m, m.media_type as MediaType));
}

/**
 * What is out now: films in cinemas, and series currently airing.
 *
 * There is no single TMDB endpoint for this across both kinds the way
 * there is for trending, so it is two calls merged. `/tv/on_the_air` is
 * the closest analogue to `/movie/now_playing` — series with an episode
 * in the next week — rather than `/tv/airing_today`, which is a one-day
 * window and too thin to fill a rail.
 *
 * Interleaved rather than sorted by popularity across both, because the
 * two endpoints' popularity numbers are not on a comparable scale: a
 * long-running series accumulates far more than a film that opened on
 * Friday, so a straight sort buries every new release under television.
 * Each list is sorted within itself and then they are zipped, which keeps
 * the rail mixed however lopsided the raw numbers are.
 */
export async function fetchNowPlaying(region: string = DEFAULT_REGION): Promise<TmdbCandidate[]> {
  const apiKey = getApiKey();

  const get = async (path: string, mediaType: MediaType): Promise<TmdbCandidate[]> => {
    const res = await tmdbFetch(`${TMDB_BASE}/${path}&api_key=${apiKey}&language=en-US`);
    if (!res.ok) {
      logger.warn({ path, status: res.status }, "TMDB new-releases call failed for one kind");
      return [];
    }
    const data = (await res.json()) as {
      results: Array<(TmdbMovie | TmdbTvListItem) & { popularity: number }>;
    };
    return data.results
      .filter((m) => m.poster_path)
      .sort((a, b) => b.popularity - a.popularity)
      .map((m) => movieToCandidate(m, mediaType));
  };

  const [films, series] = await Promise.all([
    get(`movie/now_playing?region=${region}`, "movie"),
    get(`tv/on_the_air?`, "tv"),
  ]);

  if (films.length === 0 && series.length === 0) {
    throw new Error("TMDB new releases failed for both films and series");
  }

  // Two films to each series: this rail is still mostly about what opened
  // this week, and a 50/50 split pushed half the cinema listings off it.
  const out: TmdbCandidate[] = [];
  let f = 0;
  let t = 0;
  while (out.length < 20 && (f < films.length || t < series.length)) {
    for (let i = 0; i < 2 && f < films.length && out.length < 20; i += 1, f += 1) {
      out.push(films[f]!);
    }
    if (t < series.length && out.length < 20) {
      out.push(series[t]!);
      t += 1;
    }
    if (f >= films.length && t >= series.length) break;
  }
  return out;
}

/**
 * Fetch TMDB recommendations for a given movie (the "More like this" list).
 * Returns up to 20 poster-bearing results sorted by popularity.
 */
/**
 * What TMDB thinks is similar to one film.
 *
 * Goes through tmdbFetch like every other call in this file. It used to use
 * a bare fetch, which meant no retry on a throttle — and the rail that
 * depends on it asks for five of these at once, which is precisely the
 * burst TMDB answers with 429. A throttled seed came back as a thrown
 * promise that the caller discarded, so the rail quietly lost a fifth of
 * its pool, or all of it, with nothing said anywhere.
 */
export async function fetchTmdbRecommendations(
  tmdbId: number,
  mediaType: MediaType = "movie",
): Promise<TmdbCandidate[]> {
  const apiKey = getApiKey();
  const res = await tmdbFetch(
    `${TMDB_BASE}/${mediaType}/${tmdbId}/recommendations?api_key=${apiKey}&language=en-US&page=1`
  );
  if (!res.ok) {
    // A 404 here just means TMDB doesn't know this ID — treat as empty
    if (res.status === 404) return [];
    throw new Error(`TMDB recommendations failed for ${mediaType} ${tmdbId}: ${res.status}`);
  }
  // TMDB's recommendations for a series are series and for a film are
  // films, so the kind asked for is the kind that comes back.
  const data = (await res.json()) as {
    results: Array<(TmdbMovie | TmdbTvListItem) & { popularity: number }>;
  };
  return data.results
    .filter((m) => m.poster_path)
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 20)
    .map((m) => movieToCandidate(m, mediaType));
}


// ── Similar films, and people ─────────────────────────────────────────────────

/**
 * Films worth suggesting alongside `tmdbId`.
 *
 * TMDB has two endpoints for this and they are not equivalent.
 * `/recommendations` is built from what people who watched this film went on
 * to watch, which is the better signal; `/similar` is keyword and genre
 * overlap, which on an obscure film returns things that merely share a tag.
 * Recommendations first, falling back only when it comes back thin, because
 * a weak suggestion still beats an empty row.
 */
export async function fetchSimilarMovies(
  tmdbId: number,
  limit = 12,
  mediaType: MediaType = "movie",
): Promise<TmdbCandidate[]> {
  return cached(
    `tmdb:similar:${mediaType}:${tmdbId}:${limit}`,
    SEARCH_CACHE_TTL_MS,
    async () => {
      const apiKey = getApiKey();

      const get = async (path: string): Promise<TmdbCandidate[]> => {
        const res = await tmdbFetch(
          `${TMDB_BASE}/${mediaType}/${tmdbId}/${path}?api_key=${apiKey}&language=en-US&page=1`
        );
        if (!res.ok) return [];
        const data = (await res.json()) as {
          results: Array<TmdbMovie | TmdbTvListItem>;
        };
        return data.results
          .filter((m) => m.poster_path)
          .slice(0, limit)
          .map((m) => movieToCandidate(m, mediaType));
      };

      const recommended = await get("recommendations");
      if (recommended.length >= 4) return recommended;

      // Merge rather than replace: a handful of recommendations plus
      // keyword matches beats discarding the better list for the weaker one.
      const similar = await get("similar");
      const seen = new Set(recommended.map((m) => m.tmdbId));
      return [...recommended, ...similar.filter((m) => !seen.has(m.tmdbId))].slice(0, limit);
    },
    { shouldCache: (results) => results.length > 0 }
  );
}

interface TmdbPerson {
  id: number;
  name: string;
  biography?: string;
  profile_path?: string | null;
  known_for_department?: string;
  birthday?: string | null;
  place_of_birth?: string | null;
}

export interface TmdbPersonDetails {
  id: number;
  name: string;
  biography: string;
  profileUrl: string;
  knownFor: string;
  /** Films they acted in, newest first. */
  actedIn: TmdbCandidate[];
  /** Films they directed, newest first. Empty for most actors. */
  directed: TmdbCandidate[];
}

interface TmdbPersonCredits {
  cast: Array<TmdbMovie & { id: number }>;
  crew: Array<TmdbMovie & { id: number; job: string }>;
}

interface TmdbPersonTvCredits {
  cast: Array<TmdbTvListItem>;
  crew: Array<TmdbTvListItem & { job: string }>;
}

/**
 * A person and their filmography.
 *
 * Both lists are returned rather than one chosen here: whether someone is
 * "a director" or "an actor" is not a property of the person — plenty are
 * both — so the screen decides what to lead with based on how the user
 * arrived, and can show the other list underneath.
 */
export async function fetchPersonDetails(personId: number): Promise<TmdbPersonDetails | null> {
  return cached(
    `tmdb:person:${personId}`,
    DETAILS_CACHE_TTL_MS,
    async () => {
      const apiKey = getApiKey();

      const [personResult, creditsResult, tvCreditsResult] = await Promise.allSettled([
        tmdbFetch(`${TMDB_BASE}/person/${personId}?api_key=${apiKey}&language=en-US`).then((r) =>
          r.ok ? (r.json() as Promise<TmdbPerson>) : Promise.reject(new Error(String(r.status)))
        ),
        tmdbFetch(`${TMDB_BASE}/person/${personId}/movie_credits?api_key=${apiKey}&language=en-US`).then(
          (r) => (r.ok ? (r.json() as Promise<TmdbPersonCredits>) : Promise.reject(new Error(String(r.status))))
        ),
        // Separate endpoint: /person/{id}/movie_credits has no television on
        // it at all. Without this an actor who has spent a decade in series
        // reads as having barely worked, and a series creator tapped from a
        // detail screen opens a page with nothing on it.
        tmdbFetch(`${TMDB_BASE}/person/${personId}/tv_credits?api_key=${apiKey}&language=en-US`).then(
          (r) => (r.ok ? (r.json() as Promise<TmdbPersonTvCredits>) : Promise.reject(new Error(String(r.status))))
        ),
      ]);

      if (personResult.status === "rejected") return null;
      const person = personResult.value;

      // Newest first, and only films with artwork — a filmography is browsed
      // by looking at it, and a grid of blank tiles is not browsable.
      const order = (films: TmdbMovie[]) =>
        films
          .filter((m) => m.poster_path)
          .sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? ""))
          .map((m) => movieToCandidate(m, "movie"));

      const orderTv = (shows: TmdbTvListItem[]) =>
        shows
          .filter((m) => m.poster_path)
          .sort((a, b) => (b.first_air_date ?? "").localeCompare(a.first_air_date ?? ""))
          .map((m) => movieToCandidate(m, "tv"));

      let actedIn: TmdbCandidate[] = [];
      let directed: TmdbCandidate[] = [];
      if (creditsResult.status === "fulfilled") {
        actedIn = order(creditsResult.value.cast ?? []);
        directed = order((creditsResult.value.crew ?? []).filter((c) => c.job === "Director"));
      }

      if (tvCreditsResult.status === "fulfilled") {
        // Newest first across both kinds once merged, so a career reads as
        // one timeline rather than all the films and then all the series.
        const byYear = (a: TmdbCandidate, b: TmdbCandidate) =>
          b.releaseYear.localeCompare(a.releaseYear);

        actedIn = [...actedIn, ...orderTv(tvCreditsResult.value.cast ?? [])].sort(byYear);

        // "Creator" is what TMDB puts against the people it lists in a
        // series' created_by, which is what the detail screen shows as the
        // series' director — so this is the credit that has to be here for
        // that name to lead anywhere. "Director" catches episode directors.
        // If TMDB words either differently the list is merely shorter.
        const made = (tvCreditsResult.value.crew ?? []).filter(
          (c) => c.job === "Creator" || c.job === "Director",
        );
        // Dedupe: directing four episodes of one series is four crew rows.
        const seen = new Set<number>();
        directed = [
          ...directed,
          ...orderTv(made).filter((c) => {
            if (seen.has(c.tmdbId)) return false;
            seen.add(c.tmdbId);
            return true;
          }),
        ].sort(byYear);
      }

      return {
        id: person.id,
        name: person.name,
        biography: person.biography ?? "",
        profileUrl: getPosterUrl(person.profile_path ?? null),
        knownFor: person.known_for_department ?? "",
        actedIn,
        directed,
      };
    },
    { shouldCache: (result) => result !== null }
  );
}
