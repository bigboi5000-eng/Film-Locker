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

**The share extension identifier is pinned deliberately.** Left alone,
`expo-share-intent` derives `com.filmlocker.app.share-extension` — lowercase
and hyphenated — which is *not* the App ID created above, so the build would
target an identifier with no App Group and sharing would fail silently.
`iosShareExtensionBundleIdentifier` in `app.json` overrides it to match. If
that key is ever removed, the App ID in the portal has to be renamed to suit.

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

### 6.3 Push notifications — done

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

Done 2026-09-09: key generated through `eas credentials` and assigned to
`com.filmlocker.app` on team `CP46776B8Y`. The credentials summary still
prints "No credentials set up yet!" for both targets afterwards — that line
reports *build* credentials only, and the push key is not among them.

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
  rating. See the age-rating notes below. Expect **13+**.
- **Privacy Policy URL** — `https://film-locker.com/privacy`
- **App Privacy** — answer from §5. The short version: data is collected and
  linked to identity, none of it is used for tracking, no third-party ads.
- **Pricing** — free.

The numeric **App Store Connect App ID** appears in the URL once the record
exists. Needed for `eas submit`.

#### Age rating

Apple replaced the old tiers in January 2026. The values are now 4+, 9+,
**13+**, **16+** and **18+**; 12+ and 17+ no longer exist. Since September
2026 the questionnaire also carries **mandatory social media questions**, and
they cannot be skipped on a new app submission.

The content questions ask about **what the app itself shows, not what the
films it catalogues depict**. Film Locker streams nothing, so the honest
answers are mild rather than none: TMDB synopses routinely reference drink,
drugs and violence, posters for horror and adult titles are displayed at full
size, and comments are freeform text written by users. Answer **Infrequent or
Mild** for violence, sexual content, profanity, horror themes and
alcohol/tobacco/drug references, and **None** for gambling, contests and
medical topics.

**Social media capability must be answered yes.** Apple defines it as
redistributing, amplifying or interacting with user-generated content through
a feed or similar discovery method, which describes the comments, follows and
recommendations exactly. The app gets a Social Media descriptor on its product
page and falls into the Social Media Time Allowance category in iOS 27.

There is an exception for apps whose social features are **disabled** below
age 13. **Do not claim it.** The terms say 13 or older and the privacy policy
says the app is not directed at children under 13, but nothing in the app
enforces either — Clerk never asks for a date of birth. A policy is not a
control, and claiming otherwise on the questionnaire is a misrepresentation.
Claiming it would require building an actual age gate first.

Rating low is a bad trade. Apple re-rates apps unilaterally when the
questionnaire does not match what a reviewer sees, and a user-generated
content app rated 4+ is a well-known rejection.

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
from a rejected build, so do not turn it off. `cli.appVersionSource` is
`remote`, so the counter lives on EAS servers rather than in `app.json` —
which is why `ios.buildNumber` has been removed from the config, where it
was ignored and only invited confusion.

#### Do not build from Replit, and do not use the Apple ID login

Both of these cost an afternoon on the first release.

**`eas build` needs `node_modules`.** It resolves the config plugins in
`app.json` locally before it uploads anything, so a fresh clone fails with
"Failed to resolve plugin for module expo-router". Run `pnpm install` from
the **repository root** first — the root `package.json` has a preinstall
hook that refuses npm and yarn outright.

**Apple ID login fails with "iTunes service key is empty".** It fails before
the two-factor prompt, on both Replit and a laptop, so it is neither the
password nor the network. Accepting the App Store Connect agreements did not
fix it. Do not chase it — authenticate with an **App Store Connect API key**
instead, which uses a different endpoint and no two-factor:

```
export EXPO_ASC_API_KEY_PATH="/path/to/AuthKey_XXXXXXXXXX.p8"
export EXPO_ASC_KEY_ID=XXXXXXXXXX
export EXPO_ASC_ISSUER_ID=<uuid from App Store Connect → Users and Access
                           → Integrations>
export EXPO_APPLE_TEAM_ID=CP46776B8Y
export EXPO_APPLE_TEAM_TYPE=INDIVIDUAL
```

The key is created at App Store Connect → Users and Access → Integrations →
App Store Connect API, with the **App Manager** role. The `.p8` downloads
exactly once. It can create distribution certificates, provisioning profiles
and bundle identifiers — everything a build needs. It deliberately cannot
create a push key or change capabilities, which is why §6.1 and §6.3 are
done by hand and stay done.

**Capability syncing has to be off.**

```
export EXPO_NO_CAPABILITY_SYNC=1
```

Without it the build fails at "Failed to sync capabilities". EAS reconciles
the App ID against `app.json`, finds nothing declaring Sign in with Apple —
the app uses Clerk's browser flow, not `expo-apple-authentication` — and
tries to switch the capability **off**. That is the opposite of what is
wanted: guideline 4.8 requires it. An API key cannot patch capabilities
anyway, so the request is rejected and the build stops.

All five variables are session-scoped. Use one terminal window.

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
