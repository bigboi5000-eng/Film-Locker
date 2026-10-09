/**
 * Reports what an Instagram page actually contains when fetched from this
 * server, so decisions about the extraction pipeline rest on evidence rather
 * than on what the HTML is assumed to hold.
 *
 * pageCaptionScraper fetches this same page and keeps only og:description,
 * discarding everything else. Two things would be worth a great deal if they
 * were in there:
 *
 *   • a direct video URL (og:video), which could be downloaded with a plain
 *     fetch and handed to Gemini — no yt-dlp, and so not the request pattern
 *     Instagram refuses
 *   • comment text, which frequently names the film when the caption does not
 *
 * Run it on the deployed container, whose IP is the one that matters:
 *
 *   node dist/scripts/inspect-instagram.mjs "https://www.instagram.com/reel/XXXX/"
 */

/** Meta tags worth knowing about, beyond the one already used. */
const META_KEYS = [
  "og:description",
  "og:title",
  "og:video",
  "og:video:secure_url",
  "og:video:url",
  "og:image",
  "og:type",
];

/** Markers that have historically carried comments in Instagram's HTML. */
const COMMENT_MARKERS = [
  "edge_media_to_comment",
  "edge_media_to_parent_comment",
  "edge_media_preview_comment",
  "xdt_api__v1__media__shortcode__web_info",
  '"comments"',
  '"comment_text"',
  '"text":"',
];

function metaContent(html: string, property: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`,
    "i"
  );
  const tag = html.match(pattern)?.[0];
  if (!tag) return null;
  return tag.match(/content=["']([^"']*)["']/i)?.[1] ?? null;
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node dist/scripts/inspect-instagram.mjs "<instagram url>"');
    process.exit(1);
  }

  const canonical = url.split("?")[0].replace(/\/?$/, "/");
  console.log(`Fetching ${canonical}\n`);

  const res = await fetch(canonical, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });

  const html = await res.text();

  // Where the request ended up is the reliable signal. The two string
  // markers below used to be enough, but Instagram stopped emitting both
  // while still redirecting to /accounts/login/ — so this printed "login
  // wall no" directly underneath a final url of the login page, which is
  // the one thing the whole script exists to tell you. The redirect target
  // does not depend on their markup or its wording.
  const redirectedToLogin = (() => {
    try {
      return new URL(res.url).pathname.startsWith("/accounts/login");
    } catch {
      return false;
    }
  })();
  const loginMarkersInHtml =
    html.includes("Log in to Instagram") || html.includes('"requiresLogin":true');

  console.log(`status       ${res.status}`);
  console.log(`final url    ${res.url}`);
  console.log(`html bytes   ${html.length.toLocaleString()}`);
  console.log(
    `login wall   ${
      redirectedToLogin
        ? "YES — redirected to the login page"
        : loginMarkersInHtml
          ? "YES — login markers in the HTML"
          : "no"
    }\n`
  );

  console.log("META TAGS");
  for (const key of META_KEYS) {
    const value = metaContent(html, key);
    console.log(`  ${key.padEnd(22)} ${value ? value.slice(0, 160) : "(absent)"}`);
  }

  console.log("\nCOMMENT MARKERS");
  for (const marker of COMMENT_MARKERS) {
    const count = html.split(marker).length - 1;
    console.log(`  ${marker.padEnd(45)} ${count === 0 ? "absent" : `${count} occurrence(s)`}`);
  }

  // A direct media URL is the single most valuable thing that could be in
  // here, so look for one however it is spelled.
  const mediaUrls = [...html.matchAll(/https:\/\/[^"'\s]*\.mp4[^"'\s]*/g)].map((m) => m[0]);
  const unique = [...new Set(mediaUrls)];
  console.log(`\nMP4 URLS IN PAGE: ${unique.length}`);
  for (const u of unique.slice(0, 3)) console.log(`  ${u.slice(0, 200)}`);

  console.log("\nIf an mp4 URL appears above, try fetching it directly — a plain");
  console.log("GET is a different request pattern from the one yt-dlp is refused on.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
