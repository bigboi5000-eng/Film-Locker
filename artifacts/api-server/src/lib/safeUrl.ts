/**
 * safeUrl.ts
 *
 * Guard for URLs that arrive from users and then get fetched by the server
 * itself — the page-caption scrape, the share.google redirect resolver, and
 * yt-dlp all take whatever URL was submitted to
 * POST /movies/process-social-link.
 *
 * The request body only validates `url` as a well-formed URL, which happily
 * accepts `http://169.254.169.254/…` (cloud metadata), `http://localhost:5432`
 * (our own Postgres), `http://something.railway.internal/…` (the private
 * network Railway puts services on), and `file:///…` (yt-dlp reads local
 * paths). Nothing downstream re-checks, so without this a user could aim the
 * server at its own internals.
 *
 * The check is deliberately a scheme + hostname shape test rather than a DNS
 * resolution check: resolving here would still leave a gap between the check
 * and the actual request (the name can resolve differently the second time),
 * and every host this app legitimately fetches is a public social-media
 * domain, so literal-IP and internal-suffix hostnames have no business here
 * at all.
 */

/** Hostname suffixes that only ever refer to something inside our network. */
const BLOCKED_SUFFIXES = [
  ".railway.internal",
  ".internal",
  ".local",
  ".localhost",
  ".home.arpa",
];

const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);

/** IPv4 in a range that is private, loopback, link-local, or otherwise not public. */
function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;

  const octets = parts.map((p) => {
    // Reject anything non-decimal or out of range, including the octal and
    // zero-padded forms ("0177.0.0.1") that parse as loopback in some stacks.
    if (!/^\d{1,3}$/.test(p)) return NaN;
    const n = Number(p);
    return n >= 0 && n <= 255 ? n : NaN;
  });
  if (octets.some(Number.isNaN)) return false;

  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 || // 0.0.0.0/8 "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved
  );
}

function isPrivateIpv6(host: string): boolean {
  // URL parsing hands IPv6 hosts back wrapped in brackets.
  const inner = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (!inner.includes(":")) return false;

  const lower = inner.toLowerCase();
  if (lower === "::" || lower === "::1") return true; // unspecified, loopback
  if (lower.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(lower)) return true; // unique-local fc00::/7

  // Addresses that wrap an IPv4 address in their low 32 bits: IPv4-mapped
  // (::ffff:a.b.c.d) and the NAT64 well-known prefix (64:ff9b::a.b.c.d).
  // Both are judged by the IPv4 address they carry, since that is what the
  // connection actually reaches.
  //
  // Note the low half may appear in either notation: WHATWG URL parsing
  // rewrites "::ffff:169.254.169.254" to its hex form "::ffff:a9fe:a9fe",
  // so matching only the dotted form would miss exactly the address this is
  // meant to catch.
  const embedded = lower.match(/^(?:::ffff:|64:ff9b::)(.+)$/);
  if (embedded) {
    const tail = embedded[1];

    if (/^\d+\.\d+\.\d+\.\d+$/.test(tail)) return isPrivateIpv4(tail);

    const hextets = tail.split(":");
    if (hextets.length === 2 && hextets.every((h) => /^[0-9a-f]{1,4}$/.test(h))) {
      const [high, low] = hextets.map((h) => parseInt(h, 16)) as [number, number];
      const dotted = [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
      return isPrivateIpv4(dotted);
    }
  }

  return false;
}

/**
 * True when `rawUrl` is an http(s) URL pointing at a plausibly public host.
 *
 * Returns false — rather than throwing — so callers can treat a rejected URL
 * the same as any other "nothing found here" outcome.
 */
export function isPubliclyFetchableUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  // file:, data:, ftp:, gopher: — yt-dlp accepts several of these even
  // though fetch() does not.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();
  if (!host) return false;
  if (BLOCKED_HOSTNAMES.has(host)) return false;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  // A bare single-label host ("postgres", "api") can only be an internal
  // service name — every real social domain has a dot in it.
  if (!host.includes(".") && !host.includes(":")) return false;
  if (isPrivateIpv4(host)) return false;
  if (isPrivateIpv6(host)) return false;

  return true;
}
