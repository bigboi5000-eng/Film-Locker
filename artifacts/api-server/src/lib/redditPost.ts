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
import { fetchRedditPostViaApify, hasApifyToken } from "./apifyReddit";
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
async function resolveShareLink(url: string, warn?: WarnFn): Promise<string> {
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
    const good = isRedditUrl(final) && isPubliclyFetchableUrl(final) && final !== url;
    warn?.(
      { url, final, status: res.status, resolved: good },
      good ? "reddit: share link resolved" : `reddit: share link did not resolve (status ${res.status})`
    );
    return good ? final : url;
  } catch (err) {
    warn?.({ url, err }, "reddit: share link could not be followed");
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

/** Whether this deployment has been given Reddit API credentials. */
export function hasRedditCredentials(): boolean {
  return Boolean(process.env["REDDIT_CLIENT_ID"] && process.env["REDDIT_CLIENT_SECRET"]);
}

/**
 * An application-only token, kept until shortly before it expires.
 *
 * Reddit issues these for a day at a time, so fetching one per post would be
 * a wasted round trip on every share — and the rate limit counts it.
 */
let token: { value: string; expiresAt: number } | null = null;

async function getToken(warn?: WarnFn): Promise<string | null> {
  if (token && token.expiresAt > Date.now()) return token.value;

  const id = process.env["REDDIT_CLIENT_ID"];
  const secret = process.env["REDDIT_CLIENT_SECRET"];
  if (!id || !secret) return null;

  try {
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
      },
      body: "grant_type=client_credentials",
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
      // Said plainly: this is a configuration problem, not a Reddit outage,
      // and the two are indistinguishable from a bare status.
      warn?.({ status: res.status, detail }, `reddit: could not get a token (${res.status}) — check REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET`);
      return null;
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      warn?.({}, "reddit: token response carried no token");
      return null;
    }

    // A minute of margin, so a request is never made with a token that
    // expires while it is in flight.
    const ttl = (data.expires_in ?? 3600) * 1000 - 60_000;
    token = { value: data.access_token, expiresAt: Date.now() + Math.max(ttl, 0) };
    warn?.({ expiresInSec: data.expires_in ?? null }, "reddit: got an application token");
    return token.value;
  } catch (err) {
    warn?.({ err }, "reddit: token request failed outright");
    return null;
  }
}

/** The post's id out of a canonical URL: /r/<sub>/comments/<id>/<slug>. */
function postIdFrom(url: string): string | null {
  const m = /\/comments\/([A-Za-z0-9]+)/.exec(url);
  return m?.[1] ?? null;
}

/**
 * The sanctioned route, and the only one that works from here.
 *
 * www.reddit.com/....json answers a browser perfectly well and refuses this
 * server with a 403: Reddit blocks unauthenticated reads from datacentre
 * addresses, which is what any cloud host is. The OAuth endpoint is the same
 * data through the front door — free, a hundred requests a minute, and
 * indifferent to where the request comes from.
 */
async function tryOAuth(
  postId: string,
  warn?: WarnFn
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; detail: string }> {
  const bearer = await getToken(warn);
  if (!bearer) return { ok: false, status: 0, detail: "no token" };

  const url = `https://oauth.reddit.com/comments/${postId}?raw_json=1&limit=${MAX_COMMENTS}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${bearer}`, "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) {
      // A token can be revoked or expire early; drop it so the next attempt
      // fetches a fresh one rather than reusing a dead one all day.
      if (res.status === 401) token = null;
      const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 200);
      return { ok: false, status: res.status, detail };
    }
    return { ok: true, body: await res.json() };
  } catch (err) {
    return { ok: false, status: 0, detail: String(err).slice(0, 200) };
  }
}

/**
 * Ask one host for the post's JSON.
 *
 * Two are worth trying. www.reddit.com is the canonical one; old.reddit.com
 * is served by different infrastructure and frequently answers when the new
 * one will not — which matters because this runs from a cloud host, and
 * Reddit is markedly less willing to talk to datacentre addresses than to
 * domestic ones.
 */
async function tryHost(
  jsonPath: string,
  host: string,
  warn?: WarnFn
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; detail: string }> {
  const jsonUrl = `https://${host}${jsonPath}`;
  try {
    const res = await fetch(jsonUrl, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      redirect: "follow",
    });

    if (!res.ok) {
      // The first line of the body, because Reddit's refusals are not all
      // the same refusal and the status alone does not separate them: a
      // blocked address, a rate limit and a private subreddit are three
      // different problems with three different answers.
      const text = await res.text().catch(() => "");
      const detail = text.replace(/\s+/g, " ").trim().slice(0, 200);
      return { ok: false, status: res.status, detail };
    }

    return { ok: true, body: await res.json() };
  } catch (err) {
    warn?.({ jsonUrl, err }, "reddit: request failed outright");
    return { ok: false, status: 0, detail: String(err).slice(0, 200) };
  }
}

async function fetchRedditPostUncached(url: string, warn?: WarnFn): Promise<RedditPost | null> {
  const resolved = await resolveShareLink(url, warn);
  const base = resolved.split("?")[0]!.replace(/\/$/, "");

  // A share link that did not resolve has no .json of its own, so say so
  // rather than appending one and reporting the 404 that follows as though
  // Reddit had refused the post.
  if (/\/s\/[A-Za-z0-9]+$/.test(base)) {
    warn?.({ url }, "reddit: share link did not resolve to a post — cannot read it");
    return null;
  }

  let path: string;
  try {
    const u = new URL(base);
    path = `${u.pathname}.json?raw_json=1&limit=${MAX_COMMENTS}`;
  } catch {
    warn?.({ url, base }, "reddit: resolved to something that is not a url");
    return null;
  }

  const attempts: Array<{ via: string; status: number; detail: string }> = [];

  // The authenticated route first where it is available, rather than after
  // two refusals. www.reddit.com answers a browser and 403s this server —
  // Reddit blocks unauthenticated reads from datacentre addresses — so with
  // credentials in hand the public hosts are two wasted round trips on the
  // way to the one that works.
  const postId = postIdFrom(base);
  if (postId && hasRedditCredentials()) {
    const result = await tryOAuth(postId, warn);
    if (result.ok) return parsePost(result.body, url, warn);
    attempts.push({ via: "oauth.reddit.com", status: result.status, detail: result.detail });
  }

  // Still tried, and not only as a fallback: with no credentials configured
  // this is the whole mechanism, and it works perfectly from a machine
  // Reddit is willing to talk to — a laptop, or anywhere not in a
  // datacentre.
  // Three public hosts, because they are not all blocked identically.
  // api.reddit.com is the JSON API's own alias and old.reddit.com is served
  // by separate infrastructure; either occasionally answers where www does
  // not. All three are free and a refusal costs one round trip.
  for (const host of ["www.reddit.com", "api.reddit.com", "old.reddit.com"]) {
    const result = await tryHost(path, host, warn);
    if (result.ok) {
      if (attempts.length) warn?.({ url, host, attempts }, "reddit: a later route answered");
      return parsePost(result.body, url, warn);
    }
    attempts.push({ via: host, status: result.status, detail: result.detail });
  }

  // Last, because it is the only one that costs money. Reddit's own API is
  // free and would have answered above; this is here because registering
  // for it is not always possible, and a post nobody can read is worth a
  // fraction of a penny.
  if (hasApifyToken()) {
    try {
      const viaApify = await fetchRedditPostViaApify(url, warn);
      if (viaApify) {
        warn?.({ url, attempts }, "reddit: Apify answered where Reddit would not");
        return {
          title: viaApify.title,
          selfText: viaApify.selfText,
          comments: viaApify.comments,
        };
      }
      attempts.push({ via: "apify", status: 0, detail: "returned nothing usable" });
    } catch (err) {
      attempts.push({ via: "apify", status: 0, detail: String(err).slice(0, 200) });
    }
  }

  const first = attempts[0]!;
  // The status is in the message as well as the payload: a collapsed log
  // line showing only "refused" cannot be acted on, and this one is read
  // far from the machine that wrote it. The hint is there because a 403
  // from a cloud host has one cause and one answer, and nobody should have
  // to rediscover that.
  const blocked = attempts.some((a) => a.status === 403);
  const hint =
    blocked && !hasRedditCredentials() && !hasApifyToken()
      ? " — Reddit blocks unauthenticated reads from datacentre addresses; set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET, or APIFY_TOKEN, to get round it"
      : blocked && !hasRedditCredentials()
        ? " — Reddit blocks unauthenticated reads from datacentre addresses, and Apify did not cover it either; REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET is the free route"
        : "";
  warn?.(
    { url, path, attempts },
    `reddit: refused — ${attempts.map((a) => `${a.via} ${a.status}`).join(", ")}` +
      (first.detail ? ` — ${first.detail}` : "") +
      hint
  );
  return null;
}

function parsePost(body: unknown, url: string, warn?: WarnFn): RedditPost | null {
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
