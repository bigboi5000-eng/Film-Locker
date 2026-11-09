const LAST_UPDATED = "November 9, 2026";
const CONTACT_EMAIL = "hello@film-locker.com";

const PAGE_STYLE = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 720px; margin: 0 auto; padding: 32px 20px 80px; background: #FFFFFF; }
  h1 { font-size: 26px; margin-bottom: 4px; }
  .updated { color: #6B7280; font-size: 14px; margin-bottom: 32px; }
  h2 { font-size: 18px; margin-top: 32px; margin-bottom: 8px; color: #111827; }
  p, li { font-size: 15px; color: #374151; }
  ul { padding-left: 20px; }
  li { margin-bottom: 6px; }
  a { color: #0066FF; }
  .note { background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 14px 16px; font-size: 14px; color: #4B5563; margin-top: 32px; }
`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — Film Locker</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <h1>${title}</h1>
  <p class="updated">Last updated: ${LAST_UPDATED}</p>
  ${body}
</body>
</html>`;
}

/**
 * The privacy policy and terms used to be generated here too. They are
 * on the website now — a single copy, which is the only arrangement that
 * does not drift — and /privacy and /terms on this server redirect to
 * it. Support stays here: it is the one legal-ish page with no website
 * equivalent, and it ships with the API it describes.
 */

export function supportHtml(): string {
  return page(
    "Support",
    `
    <p>
      Film Locker is a place to keep the films you mean to watch, the ones
      you have seen, and what you thought of them — and to swap them with
      people you know.
    </p>

    <h2>Get in touch</h2>
    <p>
      Email <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> and a
      person will answer. Please say which device you are on and what you
      were doing, which makes most things much quicker to sort out.
    </p>

    <h2>Common questions</h2>

    <h3>How do I add a film?</h3>
    <p>
      Search for it on the Home or Films tab, or paste a link to a post
      about it — Instagram, TikTok, Reddit and most of the rest — and the
      films mentioned in it are identified for you. You can also share a
      post to Film Locker directly from another app.
    </p>

    <h3>Do I need an account?</h3>
    <p>
      Not to browse or search. An account is needed only to keep a list of
      your own, rate films, or share them with friends.
    </p>

    <h3>I am not getting notifications</h3>
    <p>
      Check Settings inside the app, under Notifications, where each kind
      can be turned on or off, and check that notifications are allowed for
      Film Locker in your device settings.
    </p>

    <h3>How do I delete my account?</h3>
    <p>
      In the app: your profile, then Delete account. It removes your films,
      ratings, comments, messages and follows, and cannot be undone.
    </p>

    <h2>Privacy and terms</h2>
    <p>
      Our <a href="/privacy">privacy policy</a> explains what is collected
      and why, and the <a href="/terms">terms of service</a> cover using the
      app.
    </p>

    <div class="note">
      Film data and images come from The Movie Database (TMDB). Film Locker
      is not affiliated with or endorsed by TMDB.
    </div>
  `,
  );
}
