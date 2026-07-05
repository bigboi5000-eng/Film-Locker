/**
 * Heuristic caption parser — extracts potential movie title candidates
 * from social media captions without requiring an AI API.
 *
 * Strategies (in priority order):
 * 1. Quoted strings: "The Godfather", 'Dune'
 * 2. Smart quotes: "Oppenheimer", 'Interstellar'
 * 3. Hashtags decoded as title case: #TheMatrix → The Matrix
 * 4. 2-4 consecutive Title-Case word runs (filtering common stop words)
 */

const STOP_WORDS = new Set([
  "The", "Of", "And", "In", "A", "An", "At", "By", "For", "From",
  "Is", "It", "Its", "Not", "On", "Or", "That", "This", "To",
  "Was", "With", "You", "Your", "My", "Our", "Their", "We", "He",
  "She", "They", "Are", "Be", "Been", "Being",
  // Common social-media words unlikely to be movie titles
  "Just", "So", "Go", "Going", "Watch", "Watching", "Watched",
  "Here", "There", "Now", "New", "Very", "Really", "Actually",
  "Finally", "Today", "Tonight", "Night", "Day", "Time", "Week",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "June", "July",
  "August", "September", "October", "November", "December",
  "Film", "Movie", "Series", "Show", "Season", "Episode",
  "Good", "Great", "Best", "Worst", "Love", "Like",
]);

function decodeHashtag(tag: string): string {
  // #TheMatrix → "The Matrix", #DUNE → "DUNE", #spider_man → "Spider Man"
  return tag
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

function isLikelyMovieTitle(candidate: string): boolean {
  if (candidate.length < 2 || candidate.length > 80) return false;
  const words = candidate.split(/\s+/);
  if (words.length === 0) return false;
  // A single stop-word is not a title
  if (words.length === 1 && STOP_WORDS.has(words[0]!)) return false;
  // Reject purely numeric strings
  if (/^\d+$/.test(candidate)) return false;
  return true;
}

export function extractTitleCandidates(caption: string): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  function add(raw: string): void {
    const trimmed = raw.trim().replace(/\s+/g, " ");
    const key = trimmed.toLowerCase();
    if (!seen.has(key) && isLikelyMovieTitle(trimmed)) {
      seen.add(key);
      candidates.push(trimmed);
    }
  }

  // 1. ASCII double-quoted strings
  const doubleQuoted = caption.match(/"([^"]{2,60})"/g) ?? [];
  for (const m of doubleQuoted) add(m.slice(1, -1));

  // 2. ASCII single-quoted strings (avoid contractions)
  const singleQuoted = caption.match(/'([^']{3,60})'/g) ?? [];
  for (const m of singleQuoted) add(m.slice(1, -1));

  // 3. Smart/curly quotes
  const smartDouble = caption.match(/\u201c([^\u201d]{2,60})\u201d/g) ?? [];
  for (const m of smartDouble) add(m.slice(1, -1));
  const smartSingle = caption.match(/\u2018([^\u2019]{3,60})\u2019/g) ?? [];
  for (const m of smartSingle) add(m.slice(1, -1));

  // 4. Hashtags
  const hashtags = caption.match(/#([A-Za-z][A-Za-z0-9_]*)/g) ?? [];
  for (const h of hashtags) add(decodeHashtag(h.slice(1)));

  // 5. Consecutive Title-Case runs (2–5 words)
  //    Match words that start with an uppercase letter
  const words = caption.split(/(\s+|[,;:.!?|—–])/);
  let run: string[] = [];
  for (const token of words) {
    const word = token.trim();
    if (!word) {
      if (run.length >= 2) add(run.join(" "));
      run = [];
      continue;
    }
    const isTitleCase = /^[A-Z][a-zA-Z''-]{0,}$/.test(word);
    if (isTitleCase) {
      run.push(word);
      if (run.length >= 5) {
        add(run.join(" "));
        run = [];
      }
    } else {
      if (run.length >= 2) add(run.join(" "));
      run = [];
    }
  }
  if (run.length >= 2) add(run.join(" "));

  return candidates.slice(0, 12); // cap search load
}
