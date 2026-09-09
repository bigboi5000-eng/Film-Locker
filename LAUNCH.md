# Launch checklist

Things that differ between the internal test builds and a real App Store /
Play Store release. Written down because most of them are one-time account
setup that is easy to half-finish and hard to spot afterwards.

Status is marked per section: **done** items are recorded so they are not
redone or undone by accident.

## 1. Clerk production instance — done

The app authenticates through Clerk, and a store release needs a
**production** instance (`pk_live_…`) rather than the development one test
builds started on.

Current state:

- Production instance live on `clerk.film-locker.com`.
- `pk_live_Y2xlcmsuZmlsbS1sb2NrZXIuY29tJA` is in **both** `eas.json` build
  profiles. Preview deliberately shares it so internal builds exercise the
  same instance a release will.
- `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` are set in Railway.
- Google sign-in works, using our own Google Cloud OAuth client.
- The native redirect `film-locker://oauth-native-callback` is allowlisted
  under **Native applications → Allowlist for mobile SSO redirect**. Production
  instances validate this; development instances do not, which is why it only
  surfaced at launch prep.

The publishable key is not a secret — it ships inside the app binary by
design. The **secret key must only ever live in Railway's environment
variables**, never in the repo.

### Email delivery — done

`clkmail`, `clk._domainkey` and `clk2._domainkey` are live on
`film-locker.com`, and email + password sign-up sends its verification code.
Verified 2026-09-09. If that ever regresses, the records are the first thing
to check: values come from Clerk → Domains, and they must be **DNS only**
(grey cloud) in Cloudflare.

Sign in with Apple is also done — see §6.2.

### Existing accounts do not carry over

Every table keys off `clerk_id`, and a new Clerk instance issues new user IDs,
so accounts made against the development instance are orphaned. That was
absorbed before real users existed; it is not a live concern now.

## 2. Database

- Confirm **backups are enabled** on the Railway Postgres instance. Losing the
  database is a far likelier bad day than a breach.
- Migrations apply on container start (see `Dockerfile`), and the server logs
  `schemaUpToDate` on boot. If that ever reads `false`, the deploy is running
  against a schema the code does not match and endpoints touching new columns
  will 500.
- Use `migrate`, never `drizzle-kit push`, against this database. Push
  reshapes the schema and records nothing in the migrations ledger; that is
  how the two fell out of step once already.

## 3. API domain — done

`api.film-locker.com` points at the Railway service, DNS-only in Cloudflare.
Proxying it caused app requests to be treated as bot traffic while a browser
sailed through, so leave the cloud grey.

`EXPO_PUBLIC_*` values are compiled into the binary, so changing this later
means a new store release.

## 4. Store requirements already handled

- **Account deletion** — `DELETE /users/me` wipes every row the app holds and
  is wired into the profile screen. Apple requires this for any app with
  accounts (5.1.1(v)).
- **Privacy policy and terms** — on the website, linked from the profile
  screen and sign-up via `lib/legalLinks.ts`, and served as a fallback at the
  API's `/privacy` and `/terms`.
- **Blocking and reporting** — required for user-generated content (1.2). The
  report sheet also shows `hello@film-locker.com` and a 24-hour commitment.
- **TMDB attribution** — in the profile's About card, as TMDB's terms require.
- **Export compliance** — `usesNonExemptEncryption: false` in `app.json`, so
  App Store Connect stops asking on every upload.
- **Rate limiting**, and production error messages that don't leak internals.

## 5. What the app collects, for the App Privacy questionnaire

- Email address (via Clerk), optional username, display initials, avatar
- Films saved, watched status, ratings, playlists
- Comments and community ratings
- Follows, and messages — messages are a **fixed vocabulary** of emoji and
  canned phrases, not freeform text
- Expo push token, when notifications are granted
- Photos, only when the user picks one to identify films in it. The image is
  sent to Google Gemini for analysis and not stored.

No tracking, no advertising, no third-party analytics. Passwords are never
seen or stored by this app — Clerk handles them.

## 6. iOS submission

Do these in order. Several later steps depend on identifiers created earlier.

### 6.1 Apple Developer portal — identifiers — done

At <https://developer.apple.com/account>.

1. **Team ID** — Membership details. A 10-character string. Needed in three
   places below, so note it now.
2. **App ID** for `com.filmlocker.app`, with these capabilities enabled:
   - **Push Notifications**
   - **Sign in with Apple**
   - **App Groups**
3. **App Group** `group.com.filmlocker.app`. The share extension and the app
   pass the shared URL through this; without it, sharing a link into Film
   Locker on iOS silently does nothing. Declared in `app.json` under the
   `expo-share-intent` plugin.
4. **App ID for the share extension**: `com.filmlocker.app.ShareExtension`,
   with the same App Group enabled.

EAS creates most of these on the first build, but App Groups are the one it
is least reliable about. Creating them by hand first costs two minutes and
avoids a failed build.

### 6.2 Sign in with Apple, for Clerk — done

Guideline 4.8 makes this **mandatory** because the app offers Google sign-in.

Working as of 2026-09-09, verified from the Android APK: the app uses Clerk's
browser-based Apple flow rather than Apple's native sheet, so both platforms
walk the identical path and Android can prove the configuration before any
iOS build exists. `SHOW_APPLE_SIGN_IN` in `lib/appleSignIn.ts` is currently
`true` on both platforms for that reason; set it back to
`Platform.OS === 'ios'` before the Play Store release.

**The private key is the step that will waste your afternoon.** Paste the
`.p8` into Clerk *with* its `-----BEGIN PRIVATE KEY-----` and
`-----END PRIVATE KEY-----` lines, and with its **line breaks intact**. Copy
it straight from the file, never through a rich-text editor:

```
cat AuthKey_XXXXXXXXXX.p8 | pbcopy              # macOS
Get-Content -Raw AuthKey_XXXXXXXXXX.p8 | Set-Clipboard   # PowerShell
```

A value that has been flattened to one line fails Go's PEM decoder, which
then falls back to parsing the literal text and reports an ASN.1 error about
mismatched tags — the `tag:13 length:45` in that message is the byte `0x2D`,
i.e. the `-` of the header it should never have been reading. The error names
nothing about newlines, so it is easy to chase the wrong thing for an hour.
Clear Clerk's field completely before re-pasting; leftovers merge silently.

The button will fail until all four values exist: Services ID, Team ID, Key ID
and the key itself.

Four artefacts, in this order:

1. **Services ID** — Identifiers → `+` → Services IDs. Something like
   `com.filmlocker.app.signin`. **This is the "client ID" Clerk asks for**,
   not the bundle ID. Enable Sign in with Apple on it, then Configure:
   - Primary App ID: `com.filmlocker.app`
   - Domain: `clerk.film-locker.com`
   - Return URL: copy it **from Clerk's Apple connection page** rather than
     typing it. Clerk shows the exact string; it is normally
     `https://clerk.film-locker.com/v1/oauth_callback`.
2. **Key** — Keys → `+`, enable Sign in with Apple, choose the primary App ID,
   download the `.p8`. **It downloads exactly once.** Note the Key ID.
3. In **Clerk → production instance → Social Connections → Apple**, switch to
   custom credentials and supply: Services ID, Team ID, Key ID, and the
   contents of the `.p8`.
4. Optional but worth doing: **Configure Sign in with Apple for Email
   Communication** and register `film-locker.com`, so mail still reaches users
   who chose Apple's private relay address.

### 6.3 Push notifications

`lib/pushNotifications.ts` requests permission and fetches an Expo push token.
Delivery goes through Expo's push service, which talks to APNs on our behalf,
so **EAS needs an APNs key stored against the project**. Nothing in `app.json`
configures this; EAS sets the `aps-environment` entitlement itself on a
production build.

Prerequisite: the App ID `com.filmlocker.app` must already have the **Push
Notifications** capability enabled (§6.1).

**Let EAS create and hold the key.** From `artifacts/film-locker`:

```
eas credentials
```

Pick **iOS** → the **production** profile → **Push Notifications: Manage your
Apple Push Notifications Key** → **Set up a new key**. It asks for an Apple
login, creates the key in the Developer account over Apple's API, and stores
it. Answering yes when the first `eas build` offers to do this is the same
thing. Re-running `eas credentials` afterwards should list a **Push Key** with
its Key ID, which is how you confirm it took.

**Apple allows only two APNs keys per team.** If both slots are already used,
EAS cannot create a third and the step fails. Reuse an existing key instead:
`eas credentials` → **Use an existing key**, then supply the `.p8`, its Key ID
and the Team ID. This is the only case where the manual path is needed.

Manual creation, if you want the key in hand: developer.apple.com → **Keys** →
`+` → name it → tick **Apple Push Notifications service (APNs)** → Continue →
Register → Download. **The `.p8` downloads exactly once.** Note the Key ID,
then upload it through `eas credentials`.

One key covers every app on the team, so do not delete it later while tidying.

Push cannot be tested on a simulator; it needs a TestFlight build on a real
device. A signed-in user who grants the permission prompt should get a row in
`users.expo_push_token` via `PUT /users/push-token`. An empty column after
granting means the token was never fetched, not that delivery failed.

### 6.4 App Store Connect — the app record

At <https://appstoreconnect.apple.com> → Apps → `+` → New App.

- Platform: iOS
- Bundle ID: `com.filmlocker.app` (must already exist from 6.1)
- SKU: any private string, e.g. `film-locker-001`
- Primary language, and the app name as it appears on the store

Then fill in:

- **App Information** — category **Entertainment**; content rights; age
  rating. Expect **12+** once the user-generated-content questions are
  answered honestly.
- **Privacy Policy URL** — `https://film-locker.com/privacy`
- **App Privacy** — answer from §5. The short version: data is collected and
  linked to identity, none of it is used for tracking, no third-party ads.
- **Pricing** — free.

The numeric **App Store Connect App ID** appears in the URL once the record
exists. Needed for `eas submit`.

### 6.5 Build and upload

```
cd artifacts/film-locker
eas build --profile production --platform ios
eas submit --platform ios --latest
```

The first build prompts to create signing credentials — let EAS manage them
unless you have a reason not to. `eas submit` asks for your Apple ID, Team ID
and the App Store Connect App ID, and can write them into `eas.json` under
`submit.production.ios` for next time.

`autoIncrement` is on for the production profile, so build numbers rise on
their own. App Store Connect refuses a build number it has seen before, even
from a rejected build, so do not turn it off.

Processing takes roughly 10–30 minutes before the build appears in TestFlight.

### 6.6 Before submitting for review

- **Install from TestFlight and actually use it.** This is the first time the
  iOS build has ever run: Sign in with Apple, the share extension, and push
  notifications have no iOS test history at all.
- **Screenshots** — 6.9" (1320×2868) is required. iPhone only, since
  `supportsTablet` is false.
- **Demo account** — App Review needs working credentials. Film Locker is a
  social app, so a fresh empty account shows a reviewer almost nothing: create
  one with films, a playlist and a couple of follows, and say so in the review
  notes.
- **Review notes** — point out where blocking, reporting and account deletion
  live. Reviewers check for these on any app with user-generated content and
  finding them quickly avoids a rejection round.

### 6.7 Known iOS risks

- **Sign in with Apple goes through Clerk's browser flow**, not Apple's native
  sheet — `expo-apple-authentication` is not installed. This is accepted in
  practice, but the native sheet is what Apple's guidelines illustrate. Moving
  to it means adding `@clerk/expo-google-signin`'s Apple counterpart and
  `expo-apple-authentication`, plus a rebuild.
- **The share extension has never run.** Its config is complete and mirrors
  the working Android path, but iOS delivers the URL through an app group
  rather than an intent, and that half is untested.
