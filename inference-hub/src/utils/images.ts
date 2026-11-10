/**
 * Images attached to Playground messages. They are sent inline as data URLs through the
 * Kubernetes API server proxy, so large photos are scaled down first to keep requests small.
 */

export const MAX_IMAGES = 4;
/** Longest side after scaling; vision models resize to a few hundred pixels per tile anyway. */
export const MAX_SIDE = 1536;
/** Size limit of one data URL (about 3 MB of image data). */
export const MAX_DATA_URL_LENGTH = 4_000_000;
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Width and height that fit in `maxSide` and keep the aspect ratio. */
export function scaledSize(width: number, height: number, maxSide = MAX_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

/** Reads an image file as a data URL, scaled down to MAX_SIDE when it is larger. */
export async function readImage(file: File): Promise<string> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error(`${file.name}: only PNG, JPEG, WebP and GIF images are supported.`);
  }
  let url: string | undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const size = scaledSize(bitmap.width, bitmap.height);
    if (size.width === bitmap.width && size.height === bitmap.height && file.size < 2_000_000) {
      url = await readAsDataUrl(file);
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, size.width, size.height);
      url = canvas.toDataURL('image/jpeg', 0.9);
    }
    bitmap.close?.();
  } catch {
    // No canvas or bitmap decoding available: send the file as it is.
    url = await readAsDataUrl(file);
  }
  if (url.length > MAX_DATA_URL_LENGTH) {
    throw new Error(`${file.name}: the image is too large to send (over about 3 MB).`);
  }
  return url;
}
