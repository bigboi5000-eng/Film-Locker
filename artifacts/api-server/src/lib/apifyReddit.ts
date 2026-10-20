/**
 * Reading a Reddit post through Apify, for when Reddit will not talk to us.
 *
 * Reddit answers a browser and refuses this server: every public host 403s,
 * because unauthenticated reads from datacentre addresses are blocked, and a
 * cloud host is nothing but a datacentre address. The sanctioned way round
 * that is Reddit's own API, which is free — and the right answer whenever
 * it is available, which is why redditPost.ts tries it first and this is
 * only reached when it is not configured or has failed.
 *
 * Apify runs from residential infrastructure, so the block does not apply.
 * It costs a fraction of a penny per post, which is a fraction of a penny
 * more than free, and it exists because registering a Reddit app is not
 * always possible.
 *
 * Deliberately built the same way as apifyInstagram.ts, including the input
 * override. Reddit actors disagree with each other far more than Instagram
 * ones do — some return the post and its comments as separate items in one
 * flat array, some nest the comments inside the post, and they do not agree
 * on what to call any of it. So the actor is configurable, its input is
 * configurable, and the output is read tolerantly rather than against one
 * actor's schema.
 */
import { cached } from "./cache";

type WarnFn = (data: Record<string, unknown>, msg: string) => void;

/**
 * A commonly used Reddit actor, and only a default. If it is the wrong one
 * for this account — not on the plan, renamed, retired — APIFY_REDDIT_ACTOR
 * replaces it without a deploy.
 */
const DEFAULT_ACTOR = "trudax~reddit-scraper";

const RUN_TIMEOUT_SECONDS = 90;
const CACHE_TTL_MS = 30 * 60 * 1000;

/** Past this, a comment section is costing more than it is answering. */
const MAX_COMMENTS = 60;

/** Shorter than this is "lol" or "same", never a film. */
const MIN_COMMENT_CHARS = 3;

export interface ApifyRedditPost {
  title: string;
  selfText: string;
  comments: string[];
}

export function hasApifyToken(): boolean {
  return Boolean(process.env["APIFY_TOKEN"]);
}

function actorId(): string {
  return process.env["APIFY_REDDIT_ACTOR"] ?? DEFAULT_ACTOR;
}

/**
 * The input the actor is sent.
 *
 * Overridable for the same reason Instagram's is, and more pressingly: what
 * actors call the field holding the URL is the thing they differ on most,
 * and getting it wrong is the quiet failure — the actor accepts the run,
 * matches nothing, and returns an empty array indistinguishable from "no
 * such post", having charged for the privilege.
 */
function buildInput(url: string, warn?: WarnFn): Record<string, unknown> {
  const template = process.env["APIFY_REDDIT_INPUT"];

  if (template) {
    try {
      return JSON.parse(template.split('"{{url}}"').join(JSON.stringify(url)));
    } catch (err) {
      warn?.({ err }, "apifyReddit: APIFY_REDDIT_INPUT is not valid JSON — using the default input");
    }
  }

  return {
    startUrls: [{ url }],
    // One post and its comments. An actor will happily walk a subreddit,
    // and every extra item is paid for and then discarded here.
    maxItems: MAX_COMMENTS + 1,
    maxPostCount: 1,
    maxComments: MAX_COMMENTS,
    skipComments: false,
    searchPosts: false,
    searchComments: false,
    searchCommunities: false,
    searchUsers: false,
    proxy: { useApifyProxy: true },
  };
}

/** The first non-empty string among these keys, at this level of an object. */
function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

const TITLE_KEYS = ["title", "postTitle", "post_title"];
const BODY_KEYS = ["selftext", "selfText", "body", "text", "postText", "description", "content"];
const COMMENT_KEYS = ["body", "comment", "text", "commentBody"];

function isCommentish(obj: Record<string, unknown>): boolean {
  const kind = String(obj["dataType"] ?? obj["type"] ?? obj["kind"] ?? "").toLowerCase();
  if (kind.includes("comment")) return true;
  // No discriminator: a thing with a body and no title is a comment.
  return !pick(obj, TITLE_KEYS) && Boolean(pick(obj, COMMENT_KEYS));
}

function addComment(text: string, out: string[]): void {
  const t = text.trim();
  if (
    t.length >= MIN_COMMENT_CHARS &&
    t !== "[deleted]" &&
    t !== "[removed]" &&
    out.length < MAX_COMMENTS
  ) {
    out.push(t);
  }
}

/**
 * Pull a post out of whatever the actor returned.
 *
 * Three shapes are known to occur and all three are handled, because which
 * one arrives depends on an actor id in an environment variable:
 *
 *   - one item per post, comments nested under it;
 *   - a flat array of posts and comments, told apart by a dataType field;
 *   - a flat array with no discriminator, where a thing with a title is the
 *     post and a thing with only a body is a comment.
 *
 * Anything that matches none of them yields nothing, which the caller
 * reports — rather than throwing, since a changed schema is a configuration
 * problem and not a crash.
 */
export function harvest(items: unknown, warn?: WarnFn): ApifyRedditPost | null {
  if (!Array.isArray(items) || items.length === 0) return null;

  let title = "";
  let selfText = "";
  const comments: string[] = [];

  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;

    if (isCommentish(obj)) {
      addComment(pick(obj, COMMENT_KEYS), comments);
      continue;
    }

    // The post. The first one wins: a run that returned several has walked
    // more than it was asked to, and the first is the one we pointed at.
    if (!title) {
      title = pick(obj, TITLE_KEYS);
      selfText = pick(obj, BODY_KEYS);
    }

    // Comments nested under the post, whatever they are called.
    for (const key of ["comments", "topComments", "commentList"]) {
      const nested = obj[key];
      if (!Array.isArray(nested)) continue;
      for (const c of nested) {
        if (typeof c === "string") addComment(c, comments);
        else if (c && typeof c === "object") addComment(pick(c as Record<string, unknown>, COMMENT_KEYS), comments);
      }
    }
  }

  if (!title && !selfText && comments.length === 0) {
    warn?.(
      { itemCount: items.length, keys: Object.keys((items[0] ?? {}) as object).slice(0, 15) },
      "apifyReddit: nothing recognisable in the actor's output — check APIFY_REDDIT_ACTOR"
    );
    return null;
  }

  return { title, selfText, comments };
}

async function run(url: string, token: string, warn?: WarnFn): Promise<ApifyRedditPost | null> {
  const endpoint =
    `https://api.apify.com/v2/acts/${actorId()}/run-sync-get-dataset-items` +
    `?timeout=${RUN_TIMEOUT_SECONDS}`;

  // The token goes in the header rather than the query string: a URL ends up
  // in error messages and logs, and this one would carry the credential.
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(buildInput(url, warn)),
    // A little beyond the actor's own ceiling, so its timeout wins and
    // reports properly rather than this one aborting first.
    signal: AbortSignal.timeout((RUN_TIMEOUT_SECONDS + 15) * 1000),
  });

  if (!res.ok) {
    // Apify's own words. An exhausted plan reads very differently from a
    // missing actor, and both are worth having in the log.
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Apify returned ${res.status}: ${detail}`);
  }

  const post = harvest(await res.json(), warn);
  if (!post) {
    warn?.({ url, actor: actorId() }, "apifyReddit: actor returned nothing usable");
    return null;
  }

  warn?.(
    { url, actor: actorId(), titleChars: post.title.length, bodyChars: post.selfText.length, comments: post.comments.length },
    "apifyReddit: post fetched"
  );
  return post;
}

export async function fetchRedditPostViaApify(url: string, warn?: WarnFn): Promise<ApifyRedditPost | null> {
  const token = process.env["APIFY_TOKEN"];
  if (!token) return null;

  // Nulls are not cached: a failed run is as likely to be a blip or a
  // misconfigured actor being fixed as a genuinely unreadable post, and
  // remembering it for half an hour would hide the fix.
  return cached(`apify-reddit:${url}`, CACHE_TTL_MS, () => run(url, token, warn), {
    shouldCache: (v) => v !== null,
  });
}
