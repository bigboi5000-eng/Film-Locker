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

/** A string if it is one and has content, otherwise null. */
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Pull the fields we use out of one dataset item.
 *
 * Defensive throughout: the actor's schema is not ours, it changes without
 * warning, and a missing field should cost us that one signal rather than
 * the whole route.
 */
function normalise(item: Record<string, unknown>): ApifyInstagramPost {
  const rawComments = Array.isArray(item["latestComments"]) ? item["latestComments"] : [];
  const comments = rawComments
    .map((c) => (c && typeof c === "object" ? str((c as Record<string, unknown>)["text"]) : null))
    .filter((t): t is string => t !== null)
    .slice(0, MAX_COMMENTS);

  const rawHashtags = Array.isArray(item["hashtags"]) ? item["hashtags"] : [];

  const duration = item["videoDuration"];

  return {
    caption: str(item["caption"]),
    hashtags: rawHashtags.filter((h): h is string => typeof h === "string"),
    comments,
    imageUrl: str(item["displayUrl"]),
    videoUrl: str(item["videoUrl"]),
    audioUrl: str(item["audioUrl"]),
    ownerUsername: str(item["ownerUsername"]),
    videoDuration: typeof duration === "number" && Number.isFinite(duration) ? duration : null,
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
    body: JSON.stringify({
      directUrls: [url],
      resultsType: "posts",
      // One post. The actor will happily walk a whole profile, and every
      // extra item is paid for and then discarded here.
      resultsLimit: 1,
      addParentData: false,
    }),
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

  const post = normalise(first as Record<string, unknown>);
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
