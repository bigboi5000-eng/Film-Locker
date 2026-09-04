const LAST_UPDATED = "September 4, 2026";
const CONTACT_EMAIL = "jakepltanner@gmail.com";

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

export function privacyPolicyHtml(): string {
  return page(
    "Privacy Policy",
    `
    <p>
      Film Locker is a movie tracking and social recommendation app. This
      page explains what information we collect, how it's used, and who
      else can see it.
    </p>

    <h2>Information we collect</h2>
    <ul>
      <li><strong>Account info:</strong> your email address, and optionally a username, display initials, and avatar. Sign-in itself is handled by our authentication provider, Clerk — we never see or store your password.</li>
      <li><strong>Your locker:</strong> films you add to your watchlist or mark as watched, and any star ratings you give them.</li>
      <li><strong>Your playlists:</strong> the playlists you create, the films in them, whether each one is public or private, and which other people's playlists you follow.</li>
      <li><strong>Social activity:</strong> who you follow and who follows you, your account's public/private setting, comments you post on films, films you recommend to people you follow, and reactions/messages you send them (a fixed set of emoji and phrases — there is no freeform messaging in this app).</li>
      <li><strong>Content you share for lookup:</strong> if you paste a social media link or caption to identify a film, that text (and, where needed, audio or video extracted from the link) is processed to figure out what film you mean. It is not stored beyond what's needed to complete that lookup.</li>
      <li><strong>Photos you choose to identify films from:</strong> if you take a photo or pick an image from your device to find the films in it — a poster, a cinema listing, a screenshot of a post — that image is sent to Google Gemini to be read. We do not store the image: it is held only for as long as the lookup takes, then deleted. The app only ever accesses the camera or a photo you specifically select; it never browses your photo library on its own.</li>
      <li><strong>Feedback:</strong> anything you submit through the in-app feedback form, along with the email on your account.</li>
      <li><strong>Push notification token:</strong> only if you enable notifications, so we can deliver them to your device.</li>
    </ul>

    <h2>How we use it</h2>
    <p>
      Solely to operate the app's features described above: showing you
      your locker, running the social/recommendation features, and
      improving the app based on feedback. We do not sell your data, and we
      do not run advertising or third-party analytics/tracking inside the app.
    </p>

    <h2>Third-party services we rely on</h2>
    <ul>
      <li><strong>Clerk</strong> — authentication and account sign-in.</li>
      <li><strong>The Movie Database (TMDB)</strong> — film details, posters, and where-to-watch info. Search terms you enter are sent to TMDB to look up matching films.</li>
      <li><strong>Google Gemini</strong> — used to identify films from a shared social link's caption, audio or video, to read films out of a photo or screenshot you choose, and to turn a natural-language search ("a 90 minute horror film like X") into film suggestions. Content you paste, share or photograph for these purposes is sent to Google for processing.</li>
      <li><strong>Expo</strong> — delivers push notifications to your device, if enabled.</li>
      <li><strong>Resend</strong> — delivers the email notification when you submit feedback.</li>
    </ul>
    <p>Each of these services processes data under its own privacy policy.</p>

    <h2>What other users can see</h2>
    <p>
      If your account is <strong>public</strong>, anyone can follow you
      without approval and see your comments on films. If your account is
      <strong>private</strong>, people need your approval to follow you, and
      only approved followers can see your comments, your public playlists,
      send you film recommendations, or message you.
    </p>
    <p>
      Anyone who opens your profile can see your username, avatar, and three
      headline numbers: how many films you have marked as watched, how many
      comments you have posted, and how many public playlists you have. These
      counts are visible whether or not they follow you. The films, comments
      and playlists behind those numbers are not.
    </p>
    <p>
      <strong>Playlists</strong> are private unless you choose to make them
      public. A public playlist can be found by its name or by the films in
      it, and other people can follow it — meaning they see its current
      contents, including changes you make later. A public playlist belonging
      to a private account is only visible to that account's approved
      followers.
    </p>
    <p>
      <strong>Your watched films</strong> can be opened from your profile only
      by people you follow who also follow you back. Following someone one way
      is not enough.
    </p>
    <p>
      Your email address is never shown to other users under any setting. You
      can block anyone at any time, which immediately removes any follow
      relationship between you and prevents them from following, messaging, or
      seeing your comments going forward.
    </p>

    <h2>Data retention & deletion</h2>
    <p>
      You can permanently delete your account at any time from Account
      Management in the app. Doing so removes your locker, ratings, comments,
      playlists, follows, blocks, messages, and feedback from our database
      immediately — this cannot be undone. One exception: if someone has
      reported you, we retain that report as a safety record even if your
      account is later deleted.
    </p>
    <p>
      Photos you use to identify films are never part of this, because they
      are never stored in the first place.
    </p>

    <h2>Children's privacy</h2>
    <p>
      Film Locker is not directed at children under 13, and we do not
      knowingly collect information from them.
    </p>

    <h2>Changes to this policy</h2>
    <p>
      If this policy changes materially, we'll update the date at the top
      of this page.
    </p>

    <h2>Contact</h2>
    <p>Questions about this policy or your data: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>

    <div class="note">
      Film Locker is an independently developed app. This policy describes
      our practices in plain terms; it is not a substitute for legal advice.
    </div>
    `
  );
}

export function termsOfServiceHtml(): string {
  return page(
    "Terms of Service",
    `
    <p>
      These terms govern your use of Film Locker. By creating an account,
      you agree to them.
    </p>

    <h2>The service</h2>
    <p>
      Film Locker lets you track films you want to watch or have watched,
      rate and comment on them, organise them into playlists, and recommend
      them to people you follow. It can identify films from a social media
      link you share, or from a photo or screenshot you choose. Film data is
      sourced from The Movie Database (TMDB); Film Locker is not affiliated
      with or endorsed by TMDB, IMDb, or any streaming service referenced in
      the app, nor by any social media platform whose links you share into it.
    </p>

    <h2>Your account</h2>
    <p>
      You're responsible for the accuracy of the information on your
      account and for activity that happens under it. One account per
      person. You must be old enough to use this app under the laws of
      your country (13 or older in most places).
    </p>

    <h2>Acceptable use</h2>
    <p>You agree not to:</p>
    <ul>
      <li>Harass, impersonate, or abuse other users;</li>
      <li>Post comments, playlist names or descriptions that are illegal, hateful, or infringe someone else's rights;</li>
      <li>Upload photos you do not have the right to use, or images of other people who have not agreed to it;</li>
      <li>Attempt to scrape, reverse-engineer, or overload the service;</li>
      <li>Use the feedback form for anything other than genuine feedback.</li>
    </ul>
    <p>
      You can block anyone directly from the app, and report a user or a
      specific comment for us to review. We don't yet have an in-app
      moderation queue — reports come straight to us — but you can also
      always reach us at
      <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>. We may
      suspend or remove any account that violates these terms.
    </p>

    <h2>Your content</h2>
    <p>
      You own the comments, ratings, playlists, and messages you post. By
      posting them, you allow Film Locker to display them to other users
      according to your account's privacy setting and each playlist's own
      public/private setting, as described in our Privacy Policy. Making a
      playlist public allows other people to find it and follow it; if you
      later make it private or delete it, it stops being visible to them.
    </p>

    <h2>Film data & AI-generated content</h2>
    <p>
      Film details come from TMDB and may be incomplete or inaccurate.
      Recommendations, film identification from shared links, and reading
      films out of a photo all use Google Gemini, and may occasionally be
      wrong — a film may be misidentified, or missed entirely. Where a film
      has been matched incorrectly you can correct it yourself before saving
      it. Always verify before relying on any of it.
    </p>

    <h2>No warranty</h2>
    <p>
      Film Locker is provided "as is," without warranties of any kind. We
      don't guarantee the service will be uninterrupted, error-free, or
      permanently available.
    </p>

    <h2>Limitation of liability</h2>
    <p>
      To the fullest extent permitted by law, Film Locker and its developer
      aren't liable for indirect, incidental, or consequential damages
      arising from your use of the app.
    </p>

    <h2>Termination</h2>
    <p>
      You may delete your account at any time from Account Management. We
      may suspend or terminate accounts that violate these terms.
    </p>

    <h2>Changes to these terms</h2>
    <p>
      If these terms change materially, we'll update the date at the top of
      this page.
    </p>

    <h2>Contact</h2>
    <p><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>

    <div class="note">
      Film Locker is an independently developed app. These terms are
      written in plain language to be genuinely useful; they are not a
      substitute for formal legal advice, and a proper legal review is
      recommended before wide public launch.
    </div>
    `
  );
}
