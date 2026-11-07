/**
 * JPEG decoding through jpeg-js (pure JavaScript, no native code), as the
 * builder sends screenshots to the server as JPEG data URLs. Output is RGBA.
 * Encoding too, for a photo cut from a screenshot and stored.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { decode, encode } from 'jpeg-js'
import { MAX_PIXELS, type Image } from './png'

export function isJpeg(buf: Uint8Array): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
}

export function decodeJpeg(buf: Uint8Array): Image {
  if (!isJpeg(buf)) throw new Error('not a JPEG')
  const out = decode(buf, {
    useTArray: true,
    formatAsRGBA: true,
    maxResolutionInMP: MAX_PIXELS / 1_000_000,
    maxMemoryUsageInMB: 256,
  })
  return { width: out.width, height: out.height, data: out.data }
}

/** An image as a JPEG at a quality from 1 to 100. */
export function encodeJpeg(img: Image, quality = 85): Uint8Array {
  const out = encode({ width: img.width, height: img.height, data: img.data }, quality)
  return new Uint8Array(out.data)
}
