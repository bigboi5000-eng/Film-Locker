/**
 * pickFilmImage.ts
 *
 * Opens the camera or the photo library and returns an image ready to send
 * to POST /movies/extract-from-image.
 *
 * Two shapes of source this is built for:
 *   • a photo of something in the world — a poster, a cinema listing, a
 *     printed programme
 *   • a screenshot of a post whose film titles are printed in the image
 *     rather than written in its caption
 *
 * Quality note: the titles being read are often small printed text in a
 * dense grid, so this deliberately does not downscale aggressively. Gemini
 * reads the image, and detail is exactly what it needs — an over-compressed
 * upload that saves a second but loses half the titles is a bad trade.
 */
import * as ImagePicker from 'expo-image-picker';

/** Mirrors the mime types the API accepts. */
type SupportedMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif';

export interface PickedFilmImage {
  base64: string;
  mimeType: SupportedMime;
}

/** Reason a pick produced nothing, so the caller can stay quiet or explain. */
export type PickFailure = 'cancelled' | 'permission-denied' | 'unreadable' | 'failed';

/** Which of the two pickers was being used, so the caller can name it. */
export type PickSource = 'camera' | 'library';

export type PickResult =
  | { ok: true; image: PickedFilmImage }
  | { ok: false; reason: PickFailure; source: PickSource };

/**
 * Map whatever the picker reports back to a mime type the API accepts.
 * `mimeType` is populated on most platforms; the file extension is the
 * fallback, and jpeg is the last resort since that is what a camera capture
 * is regardless of what gets reported.
 */
function resolveMimeType(asset: ImagePicker.ImagePickerAsset): SupportedMime {
  const reported = asset.mimeType?.toLowerCase();
  if (reported === 'image/png') return 'image/png';
  if (reported === 'image/webp') return 'image/webp';
  if (reported === 'image/heic') return 'image/heic';
  if (reported === 'image/heif') return 'image/heif';
  if (reported === 'image/jpeg' || reported === 'image/jpg') return 'image/jpeg';

  const extension = asset.uri.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';

  return 'image/jpeg';
}

function toResult(response: ImagePicker.ImagePickerResult, source: PickSource): PickResult {
  if (response.canceled) return { ok: false, reason: 'cancelled', source };

  const asset = response.assets?.[0];
  if (!asset?.base64) return { ok: false, reason: 'unreadable', source };

  return { ok: true, image: { base64: asset.base64, mimeType: resolveMimeType(asset) } };
}

const SHARED_OPTIONS = {
  mediaTypes: ['images'] as ImagePicker.MediaType[],
  base64: true,
  // 0.8 rather than a smaller number on purpose — see the quality note above.
  quality: 0.8,
  exif: false,
};

/** Opens the photo library. */
export async function pickImageFromLibrary(): Promise<PickResult> {
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return { ok: false, reason: 'permission-denied', source: 'library' };

    return toResult(await ImagePicker.launchImageLibraryAsync(SHARED_OPTIONS), 'library');
  } catch (err) {
    console.error('pickImageFromLibrary failed', err);
    return { ok: false, reason: 'failed', source: 'library' };
  }
}

/**
 * Opens the camera.
 *
 * The try/catch is not decoration. Both of these calls can reject rather than
 * return — a camera that is unavailable, a permission request made while
 * another is already in flight — and the caller invokes this as
 * `void takeFilmPhoto().then(...)`. An unhandled rejection there produces
 * exactly the symptom reported on iOS: the camera never opens and nothing at
 * all is shown to explain why.
 */
export async function takeFilmPhoto(): Promise<PickResult> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { ok: false, reason: 'permission-denied', source: 'camera' };

    return toResult(await ImagePicker.launchCameraAsync(SHARED_OPTIONS), 'camera');
  } catch (err) {
    console.error('takeFilmPhoto failed', err);
    return { ok: false, reason: 'failed', source: 'camera' };
  }
}
