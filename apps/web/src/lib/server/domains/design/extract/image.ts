/**
 * Screenshots as decoded pixels: a data URL or file bytes (PNG or JPEG,
 * told apart by their first bytes) to an RGBA image, and the image as the
 * element finder's model sees it. A retina capture (2400px wide or more) is
 * taken as scale 2 and halved for the model; the finder scales its boxes
 * back to the full image.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { decodeJpeg, isJpeg } from './jpeg'
import { decodePng, downscale, encodePng, isPng, type Image } from './png'
import { scaleOf } from './snap'

export type { Image }

/** PNG or JPEG bytes to RGBA pixels. */
export function decodeImage(bytes: Uint8Array): Image {
  if (isPng(bytes)) return decodePng(bytes)
  if (isJpeg(bytes)) return decodeJpeg(bytes)
  throw new Error('unsupported image format (PNG or JPEG only)')
}

/** A base64 data URL (as the builder sends screenshots) to RGBA pixels. */
export function decodeDataUrl(url: string): Image {
  const m = /^data:[^;,]*;base64,/.exec(url)
  if (!m) throw new Error('not a base64 data URL')
  return decodeImage(new Uint8Array(Buffer.from(url.slice(m[0].length), 'base64')))
}

/** A data URL's pixels, or null when there is none or it cannot be read. */
export function decodeDataUrlOrNull(url: string | undefined): Image | null {
  if (!url) return null
  try {
    return decodeDataUrl(url)
  } catch {
    return null
  }
}

/** The image as the model gets it: retina captures halved, then as PNG. */
export interface ModelImage {
  /** Device scale of the original (2 for a retina capture). */
  scale: number
  /** The pixels sent, at CSS-pixel size. */
  image: Image
  png: Uint8Array
}

export function modelImage(img: Image): ModelImage {
  const scale = scaleOf(img)
  const image = downscale(img, scale)
  return { scale, image, png: encodePng(image) }
}
