/**
 * apifyInstagram.ts
 *
 * Fetches an Instagram post through Apify, which runs the request from its
 * own residential infrastructure rather than from this server.
 *
 * This exists because Instagram stopped serving this server anything at all.
 * A reel fetched directly now redirects to /accounts/login/ — no
 * og:description, no og:image, no media — which took out the caption scrape,
 * the preview image and yt-dlp together, since all three were asking the
 * same blocked address for the same walled page.
 *
 * The reel that exposed this is a good illustration of the cost: its caption
 * opens "🎬 Houdini (2014)", so the existing text pipeline would have named
 * the film from the first four words. Nothing was wrong with the extraction.
 * The server simply could not see the page.
 *
 * What comes back is better than what was lost, because the actor returns
 * the post's content rather than its markup:
 *
 *   caption      the full text, which usually names the film outright
 *   hashtags     occasionally carry a title the caption only alludes to
 *   comments     where these accounts' audiences ask and answer "movie name?"
 *   displayUrl   the cover frame, on a plain CDN URL
 *   videoUrl     the mp4 itself, also a plain CDN URL
 *   audioUrl     the audio track alone, smaller than the video
 *
 * The last three matter more than they look. They are ordinary signed CDN
 * links, so the media routes no longer need yt-dlp — and yt-dlp was refused
 * Instagram media long before the page wall went up. They are also short
 * lived, with an expiry baked into the signature, so they are for using now
 * and never for storing.
 *
 * Credentials: APIFY_TOKEN. Without it this route reports itself unavailable
 * and the pipeline behaves exactly as it did before, so a deployment with no
 * token is degraded rather than broken.
 */

// Declared here rather than imported: processSocialLink.ts and
// moviePipeline.ts each declare their own copy of this one-line structural
// type, so this follows the file-local convention already in place.
import { cached } from "./cache";

type WarnFn = (data: Record<string, unknown>, msg: string) => void;

/** Apify's default actor, overridable in case a different one is preferred. */
const DEFAULT_ACTOR = "apify~instagram-scraper";

/**
 * Apify bills per run, so the sync endpoint's own ceiling is not the limit
 * that matters — a user waiting on a pasted link is. Past this it is better
 * to give up than to keep them watching a spinner.
 */
const RUN_TIMEOUT_SECONDS = 90;

/** Comments are a secondary signal; the newest few are where titles appear. */
const MAX_COMMENTS = 20;

/**
 * How long a fetched post is reused.
 *
 * A caption is written once and effectively never edited, so the thing this
 * route exists to read does not change. Comments accumulate, which is why
 * this is hours rather than days.
 *
 * The win is not one user sharing twice, it is many users sharing the same
 * reel: these accounts go viral, and the second share onward costs nothing
 * and returns instantly instead of waiting out another actor boot.
 */
const POST_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * The post's shortcode — the stable part of an Instagram URL.
 *
 * Cache keys are built from this rather than the URL because the URL is not
 * stable: every share appends its own tracking parameter, and the same reel
 * arrived three separate times as ?psln=, ?dlrf= and ?srtk=. Keyed on the
 * URL, those are three different posts and the cache never hits.
 */
function instagramShortcode(url: string): string | null {
  const match = /\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/.exec(url);
  return match?.[1] ?? null;
}

/** What the pipeline needs, lifted out of a much larger dataset item. */
export type ApifyInstagramPost = {
  caption: string | null;
  hashtags: string[];
  comments: string[];
  imageUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  ownerUsername: string | null;
  /** Seconds. Lets a long video be rejected before it is downloaded. */
  videoDuration: number | null;
};

/** Whether this route is configured at all. */
export function hasApifyToken(): boolean {
  return Boolean(process.env["APIFY_TOKEN"]);
}

function actorId(): string {
  return process.env["APIFY_INSTAGRAM_ACTOR"] ?? DEFAULT_ACTOR;
}

/**
 * The input the actor is sent.
 *
 * Overridable because the actor is now something we shop around for — a
 * faster one is worth switching to, and the thing that differs between them
 * is what they call the field holding the URL. Getting that wrong is the
 * quiet failure: the actor accepts the request, matches nothing, and returns
 * an empty array that looks exactly like "no such post".
 *
 * APIFY_INSTAGRAM_INPUT takes the input JSON verbatim, with "{{url}}" where
 * the post URL goes — copy it out of the run's Input tab, replace the URL
 * with the placeholder, and no code has to change. The quoted placeholder is
 * substituted with a JSON-encoded string so a URL never breaks the document.
 */
function buildInput(url: string, warn?: WarnFn): Record<string, unknown> {
  const template = process.env["APIFY_INSTAGRAM_INPUT"];

  if (template) {
    try {
      return JSON.parse(template.split('"{{url}}"').join(JSON.stringify(url)));
    } catch (err) {
      // Falling back rather than throwing: a malformed override should not
      // take the route down, but it must be loud, because the default input
      // may well not suit whichever actor is configured.
      warn?.({ err }, "apifyInstagram: APIFY_INSTAGRAM_INPUT is not valid JSON — using the default input");
    }
  }

  return {
    directUrls: [url],
    resultsType: "posts",
    // One post. An actor will happily walk a whole profile, and every extra
    // item is paid for and then discarded here.
    resultsLimit: 1,
    addParentData: false,
  };
}

/** A string if it is one and has content, otherwise null. */
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The first of `keys` holding a non-empty string. */
function pick(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = str(item[key]);
    if (value) return value;
  }
  return null;
}

/**
 * Pull the fields we use out of one dataset item.
 *
 * Every field is read across the names the various Instagram actors use for
 * it, because which actor is configured is now a tuning decision rather than
 * a fixed fact — apify/instagram-scraper and apify/instagram-post-scraper
 * already disagree about what they return, and a switch for the sake of
 * speed should not be a code change.
 *
 * Defensive throughout: a missing field costs that one signal, never the
 * whole route.
 */
function normalise(item: Record<string, unknown>): ApifyInstagramPost {
  const rawComments = [item["latestComments"], item["comments"], item["topComments"]].find(
    (c): c is unknown[] => Array.isArray(c) && c.length > 0,
  ) ?? [];

  const comments = rawComments
    .map((c) => {
      if (typeof c === "string") return str(c);
      if (c && typeof c === "object") {
        return pick(c as Record<string, unknown>, ["text", "comment", "body"]);
      }
      return null;
    })
    .filter((t): t is string => t !== null)
    .slice(0, MAX_COMMENTS);

  const rawHashtags = Array.isArray(item["hashtags"]) ? item["hashtags"] : [];

  const duration = [item["videoDuration"], item["duration"]].find(
    (d): d is number => typeof d === "number" && Number.isFinite(d),
  );

  return {
    caption: pick(item, ["caption", "text", "description", "title"]),
    hashtags: rawHashtags.filter((h): h is string => typeof h === "string"),
    comments,
    imageUrl: pick(item, ["displayUrl", "imageUrl", "thumbnailUrl", "coverUrl"]),
    videoUrl: pick(item, ["videoUrl", "mediaUrl", "downloadUrl"]),
    audioUrl: pick(item, ["audioUrl"]),
    ownerUsername: pick(item, ["ownerUsername", "username", "author"]),
    videoDuration: duration ?? null,
  };
}

/**
 * Fetch `url`'s post through Apify.
 *
 * Returns null when the route is not configured or the actor found nothing.
 * Throws when the call itself fails, so the caller can tell "no such post"
 * apart from "Apify is down" — the first is final, the second is worth
 * saying out loud in the logs.
 */
export async function fetchInstagramPostViaApify(
  url: string,
  warn?: WarnFn
): Promise<ApifyInstagramPost | null> {
  const token = process.env["APIFY_TOKEN"];
  if (!token) return null;

  // Keyed on the shortcode, not the URL — see instagramShortcode. A URL with
  // no shortcode in it is not cached rather than sharing one key with every
  // other such URL.
  const shortcode = instagramShortcode(url);
  if (!shortcode) {
    return fetchFromApify(url, token, warn);
  }

  return cached(
    `apify:ig:${shortcode}`,
    POST_CACHE_TTL_MS,
    () => fetchFromApify(url, token, warn),
    // A miss is never remembered: a post that was private or unavailable a
    // moment ago should not be unavailable for the next six hours.
    { shouldCache: (post) => post !== null },
  );
}

/** The actual call, separated so the cache wraps it rather than reimplements it. */
async function fetchFromApify(
  url: string,
  token: string,
  warn?: WarnFn
): Promise<ApifyInstagramPost | null> {
  // run-sync-get-dataset-items runs the actor and returns its output in one
  // request, so there is no run id to poll and no state to keep here.
  const endpoint =
    `https://api.apify.com/v2/acts/${actorId()}/run-sync-get-dataset-items` +
    `?timeout=${RUN_TIMEOUT_SECONDS}`;

  // The token goes in the header rather than the query string: a URL ends up
  // in error messages and logs, and this one would carry the credential.
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(buildInput(url, warn)),
    // A little beyond the actor's own ceiling, so its timeout wins and
    // reports properly rather than this one aborting first.
    signal: AbortSignal.timeout((RUN_TIMEOUT_SECONDS + 15) * 1000),
  });

  if (!res.ok) {
    // The body carries Apify's own reason — an exhausted plan reads very
    // differently from a broken actor, and both are worth having in the log.
    const detail = await res.text().catch(() => "");
    throw new Error(`Apify returned ${res.status}: ${detail.slice(0, 300)}`);
  }

  const items: unknown = await res.json();
  if (!Array.isArray(items) || items.length === 0) {
    warn?.({ url }, "apifyInstagram: actor returned no items");
    return null;
  }

  const first = items[0];
  if (!first || typeof first !== "object") {
    warn?.({ url }, "apifyInstagram: actor returned an item of an unexpected shape");
    return null;
  }

  const raw = first as Record<string, unknown>;
  const post = normalise(raw);

  warn?.(
    {
      url,
      owner: post.ownerUsername,
      captionChars: post.caption?.length ?? 0,
      comments: post.comments.length,
      hasImage: Boolean(post.imageUrl),
      hasVideo: Boolean(post.videoUrl),
      videoDuration: post.videoDuration,
    },
    "apifyInstagram: fetched post",
  );

  // Said out loud, because losing this is invisible otherwise.
  //
  // Not every actor returns comment text. apify/instagram-post-scraper is
  // quicker than apify/instagram-scraper partly because it does not, and
  // reports only a commentsCount — so a post whose caption names no film
  // silently loses the route that would have caught it, with the count
  // sitting right there proving the comments exist.
  if (post.comments.length === 0) {
    const counted = raw["commentsCount"];
    warn?.(
      {
        url,
        commentsCount: typeof counted === "number" ? counted : null,
        actor: actorId(),
      },
      typeof counted === "number" && counted > 0
        ? "apifyInstagram: actor returned no comment text though the post has comments — the comments fallback is unavailable with this actor"
        : "apifyInstagram: no comments on this post",
    );
  }

  return post;
}

/**
 * What the post says about itself: caption, then hashtags.
 *
 * Read on its own, and first, because it is the only part of a post its
 * author wrote. Where a film is named at all it is almost always here —
 * "🎬 Houdini (2014)" opened the caption of the reel this route was built
 * for, four words in.
 */
export function captionText(post: ApifyInstagramPost): string | null {
  const parts: string[] = [];
  if (post.caption) parts.push(post.caption);
  if (post.hashtags.length > 0) parts.push(post.hashtags.map((h) => `#${h}`).join(" "));

  const text = parts.join("\n").trim();
  return text === "" ? null : text;
}

/**
 * What the audience said, kept apart from the caption and read only when the
 * caption named nothing.
 *
 * Separate rather than appended, because mixing the two corrupts a good
 * answer with a bad one. The comments on that same Houdini reel were
 * "Halaand?", "Movie name?", "Bob?" and "Cheddar Bob 🙌" — two questions,
 * and two references to a character from a different film entirely. Run
 * together with the caption, that is a spurious second film landing in
 * somebody's watchlist next to the right one.
 *
 * They are still worth having: on the "Top 10" accounts, titles the caption
 * withholds routinely turn up where the audience asks for them. But as a
 * fallback for a caption that yielded nothing, never as a supplement to one
 * that worked.
 */
export function commentsText(post: ApifyInstagramPost): string | null {
  if (post.comments.length === 0) return null;
  return post.comments.join("\n").trim() || null;
}
