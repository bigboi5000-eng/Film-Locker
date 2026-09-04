# Launch checklist

Things that differ between the internal test builds and a real App Store /
Play Store release. Written down because most of them are one-time account
setup that is easy to half-finish and hard to spot afterwards.

## 1. Clerk production instance

The app authenticates through Clerk. Test builds have been running against a
**development** instance (`pk_test_…`, `exciting-vervet-4.clerk.accounts.dev`),
which is capped at a small number of users, is not meant to serve production
traffic, and signs its tokens with different keys than a production instance.

A store release needs a **production** instance.

### In the Clerk dashboard

1. Create a production instance for the app.
2. Enable the sign-in methods the app actually uses — **email + password**,
   **Google**, and **Apple** (see `app/(auth)/sign-in.tsx`).
3. Supply your own OAuth credentials. This is the step that catches people
   out: development instances borrow Clerk's shared Google/Apple credentials,
   production instances do not, so **Google and Apple sign-in will fail until
   you configure them**.
   - Google: create an OAuth 2.0 Client in Google Cloud Console and paste the
     client ID/secret into Clerk.
   - Apple: configure Sign In with Apple against the Apple Developer account
     you are shipping the app under.
4. Copy the two keys: `pk_live_…` (publishable) and `sk_live_…` (secret).

### Where the keys go

| Key | Goes to | How |
| --- | --- | --- |
| `pk_live_…` | `artifacts/film-locker/eas.json`, `build.production.env` | Replace the placeholder, commit |
| `sk_live_…` | Railway → api-server service → Variables | `CLERK_SECRET_KEY` |
| `pk_live_…` | Railway → api-server service → Variables | `CLERK_PUBLISHABLE_KEY` |

The publishable key is not a secret — it ships inside the app binary by
design, so committing it is fine. The **secret key must only ever live in
Railway's environment variables**, never in the repo.

Leave the `preview` profile on the `pk_test_…` key so internal test builds
keep using the development instance and don't consume production user slots.

### Existing accounts do not carry over

Every table keys off `clerk_id`. A new Clerk instance issues new user IDs, so
accounts created against the development instance will be orphaned — their
films, playlists, follows and comments will still be in the database but
unreachable by the new login.

That is fine pre-launch with test accounts. Do it **before** real users exist;
afterwards it becomes a data migration.

## 2. Database

- Confirm **backups are enabled** on the Railway Postgres instance. Losing the
  database is a far likelier bad day than a breach.
- Migrations apply automatically on container start (see `Dockerfile`), so
  there is no manual migration step at deploy time.

## 3. API domain

`EXPO_PUBLIC_DOMAIN` currently points at a Railway-generated subdomain. It
works, but it is Railway's name rather than yours: pointing a domain you own
at the service means you could move hosts later without shipping a new build
to the stores. Worth doing before release, since the value is baked into the
binary.

## 4. Store requirements already handled

- **Account deletion** — `DELETE /users/me` wipes every row the app holds and
  is wired into the profile screen. Apple requires this for any app with
  accounts.
- **Privacy policy and terms** — served at `/privacy` and `/terms`, and linked
  from the profile screen and sign-up. App Store Connect asks for the privacy
  policy URL.
- **Blocking and reporting** — required for apps with user-generated content.
- **Rate limiting** and production error messages that don't leak internals.

## 5. What the app collects, for the App Privacy questionnaire

- Email address (via Clerk), optional username, display initials, avatar
- Films saved, watched status, ratings, playlists
- Comments and community ratings
- Follows, and messages — messages are a **fixed vocabulary** of emoji and
  canned phrases, not freeform text
- Expo push token, when notifications are granted
- Photos, only when the user picks one to identify films in it. The image is
  sent to Google Gemini for analysis and not stored.

Passwords are never seen or stored by this app — Clerk handles them.
