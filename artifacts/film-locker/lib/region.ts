import * as Localization from 'expo-localization';

/**
 * Best-effort device region (ISO 3166-1 alpha-2), used to pick which
 * country's TMDB watch-provider data to show. Falls back to US when the
 * device doesn't report one (e.g. some web browsers).
 */
export function getDeviceRegion(): string {
  return Localization.getLocales()[0]?.regionCode ?? 'US';
}
