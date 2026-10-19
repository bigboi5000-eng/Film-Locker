/**
 * Reading a Reddit post, through the door Reddit leaves open.
 *
 * A Reddit link used to fall through every step of the pipeline and end at
 * yt-dlp, which is both the most expensive attempt and the one least likely
 * to work — Reddit now refuses it outright:
 *
 *     ERROR: [Reddit] Account authentication is required.
 *
 * That is a video download being refused, and a video is not what a Reddit
 * post about films is. The post is TEXT: a title, often a body, and a
 * comment section that on a subreddit like r/Letterboxd is where the list
 * actually lives.
 *
 * All of which Reddit serves for free, without authentication, to anyone who
 * adds `.json` to the URL. No API key, no token, no cookie — the same
 * endpoint the site itself uses. It needs an honest User-Agent, because
 * Reddit blocks the defaults of common HTTP clients outright, and it is rate
 * limited, which for one share at a time is no constraint at all.
 *
 * So Reddit gets its own step, ahead of the downloads, and the video
 * extractor stops being asked a question it cannot answer.
 */
import { isPubliclyFetchableUrl } from "./safeUrl";
import { cached } from "./cache";
/** Local, matching the other extractors in this directory. */
type WarnFn = (data: Record<string, unknown>, msg: string) => void;

const CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Named rather than disguised. Reddit asks for a descriptive agent and
 * throttles anything that looks like a default client; it does not ask for a
 * browser, and claiming to be one on an endpoint meant for programs is both
 * unnecessary and worse behaved.
 */
const UA = "FilmLocker/1.0 (film cataloguing app; +https://film-locker.com)";

/** How many comments to read. The list is usually near the top. */
const MAX_COMMENTS = 60;

/** Comments shorter than this are "lol", "same", "RemindMe!" — never a film. */
const MIN_COMMENT_CHARS = 3;

export interface RedditPost {
  title: string;
  /** The post's own body. Empty for a link or image post. */
  selfText: string;
  comments: string[];
}

export function isRedditUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    const h = hostname.toLowerCase();
    return h === "reddit.com" || h.endsWith(".reddit.com") || h === "redd.it" || h.endsWith(".redd.it");
  } catch {
    return false;
  }
}

/**
 * Reddit's share links (/r/<sub>/s/<id>) are redirects, and `.json` appended
 * to one is not a thing — the canonical /comments/ URL has to be found
 * first. A plain GET follows it; the response's final URL is the real post.
 */
async function resolveShareLink(url: string): Promise<string> {
  if (!/\/s\/[A-Za-z0-9]+/.test(url)) return url;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "follow",
    });
    // Only a Reddit URL is accepted back: a redirect that leaves Reddit is
    // not a post, and following it into a fetch would be somebody else's
    // server answering for this one.
    const final = res.url || url;
    return isRedditUrl(final) && isPubliclyFetchableUrl(final) ? final : url;
  } catch {
    return url;
  }
}

/**
 * A comment tree, flattened to the text worth reading.
 *
 * Reddit nests two different shapes and they must not both be walked for one
 * node, or every comment is collected once per path that reaches it. A
 * Listing holds `data.children`; a comment holds `data.body` and its own
 * `data.replies`, which is itself a Listing (or an empty string when there
 * are none). Deciding which shape this is, and descending only that way, is
 * the difference between reading a thread and reading it several times over.
 */
function collectComments(node: unknown, out: string[]): void {
  if (out.length >= MAX_COMMENTS || !node || typeof node !== "object") return;

  const data = (node as { data?: Record<string, unknown> }).data;
  if (!data) return;

  // A Listing: descend into its children and nothing else.
  const children = data["children"];
  if (Array.isArray(children)) {
    for (const child of children) collectComments(child, out);
    return;
  }

  // A comment. "[deleted]" and "[removed]" are Reddit's tombstones rather
  // than content, and a two-character reply is "lol", never a film.
  const body = typeof data["body"] === "string" ? data["body"].trim() : "";
  if (body && body.length >= MIN_COMMENT_CHARS && body !== "[deleted]" && body !== "[removed]") {
    out.push(body);
  }

  // Replies, which is where a thread's answers to "name this film" sit.
  const replies = data["replies"];
  if (replies && typeof replies === "object") collectComments(replies, out);
}

async function fetchRedditPostUncached(url: string, warn?: WarnFn): Promise<RedditPost | null> {
  const resolved = await resolveShareLink(url);
  const base = resolved.split("?")[0]!.replace(/\/$/, "");
  const jsonUrl = `${base}.json?raw_json=1&limit=${MAX_COMMENTS}`;

  const res = await fetch(jsonUrl, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    redirect: "follow",
  });

  if (!res.ok) {
    warn?.({ url, jsonUrl, status: res.status }, "reddit: json endpoint refused");
    return null;
  }

  const body = (await res.json()) as unknown;
  // A post's .json is [postListing, commentListing]. Anything else — a
  // subreddit, a user page, a search — is not a post and is left alone.
  if (!Array.isArray(body) || body.length === 0) {
    warn?.({ url }, "reddit: json was not a post");
    return null;
  }

  const first = body[0] as { data?: { children?: Array<{ data?: Record<string, unknown> }> } };
  const post = first?.data?.children?.[0]?.data;
  if (!post) {
    warn?.({ url }, "reddit: no post in the json");
    return null;
  }

  const title = typeof post["title"] === "string" ? post["title"] : "";
  const selfText = typeof post["selftext"] === "string" ? post["selftext"] : "";

  const comments: string[] = [];
  if (body.length > 1) collectComments(body[1], comments);

  warn?.(
    { url, titlePreview: title.slice(0, 120), selfTextChars: selfText.length, comments: comments.length },
    "reddit: post read"
  );

  return { title, selfText, comments };
}

export async function fetchRedditPost(url: string, warn?: WarnFn): Promise<RedditPost | null> {
  // Nulls are not cached, so a rate limit or a blip does not stick around
  // for half an hour — the same rule the TMDB details cache uses.
  return cached(`reddit:${url}`, CACHE_TTL_MS, () => fetchRedditPostUncached(url, warn), {
    shouldCache: (v) => v !== null,
  });
}

/**
 * What the author wrote, which is tried on its own first.
 *
 * The title alone is frequently the whole thing on r/Letterboxd — "My top
 * 10 of 2024" with the list in the image — so the body is appended rather
 * than preferred, and an empty one costs nothing.
 */
export function redditPostText(post: RedditPost): string {
  return [post.title, post.selfText].filter(Boolean).join("\n\n").trim();
}

/**
 * The comments, as one block, read only when the post itself named nothing.
 *
 * Separate from the post for the same reason Instagram's are: a comment
 * section is where a thread answers "what film is this", and it is equally
 * full of jokes about other films. Merging them into a post that already
 * worked would add a wrong film beside the right one.
 */
export function redditCommentsText(post: RedditPost): string {
  return post.comments.join("\n").trim();
}
