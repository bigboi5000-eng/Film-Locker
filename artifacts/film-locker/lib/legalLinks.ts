/**
 * legalLinks.ts
 *
 * Where the app sends people for the Privacy Policy and Terms of Service.
 *
 * Deliberately hardcoded rather than derived from EXPO_PUBLIC_DOMAIN: these
 * have to keep working from any build — development, preview or production —
 * and must not depend on whichever host happens to be serving the app's API
 * at the time. They also end up in store listings, where a URL that moves is
 * a problem.
 *
 * Kept in one place because they were previously written out in two screens
 * (three occurrences), which is how they came to be pointing at a Replit
 * domain long after the backend had moved to Railway.
 *
 * These are the addresses, not the pages. The text lives in one place and
 * one only: artifacts/api-server/src/lib/legalContent.ts, served at
 * api.film-locker.com/privacy and /terms. The website forwards these two
 * paths there.
 *
 * It was the other way round, with the website holding the text and the
 * API keeping a copy, and a comment here saying both had to be changed
 * together. They were not. The copy people actually read sat two months
 * stale, still saying a shared link was not stored, after the behaviour
 * had changed. The policy is generated from the code whose behaviour it
 * describes now, and deploys with it, so there is nothing to remember and
 * no second version to disagree.
 */

const SITE = 'https://film-locker.com';

export const PRIVACY_URL = `${SITE}/privacy`;
export const TERMS_URL = `${SITE}/terms`;

/**
 * The address people can reach a human on — shown wherever the app asks
 * someone to trust it with a problem (reporting another user, sending
 * feedback, the About card).
 *
 * This is deliberately a real, monitored inbox rather than a no-reply: the
 * App Store's user-generated-content rules expect a published contact point
 * for abuse reports, and someone who has just been harassed should not have
 * to hunt through a website to find one.
 */
export const CONTACT_EMAIL = 'hello@film-locker.com';
