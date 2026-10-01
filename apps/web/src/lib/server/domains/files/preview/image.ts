/**
 * Images: the size they display at, a thumbnail when the original is heavy
 * to show in a thread, and a JPEG rendition of HEIC photos (which most
 * browsers cannot show). PNG, JPEG, GIF, BMP and TIFF go through mupdf;
 * WebP and AVIF sizes come from their headers (mupdf reads neither); SVG has
 * no rasterizer here and records nothing.
 */
import { loadMupdf, destroy, cappedRenderScale } from './mupdf'
import { childBoxes, findChild, u32be } from './boxes'
import {
  NO_DEADLINE,
  NOTHING_TO_DERIVE,
  PreviewRefusedError,
  loadDependency,
  type Deadline,
  type DerivedObject,
  type PreviewResult,
} from './result'

const MB = 1024 * 1024

/** Originals heavier than this get a thumbnail. */
const THUMB_OVER_BYTES = 1.5 * MB
/** Originals longer than this on either side get a thumbnail. */
const THUMB_OVER_SIDE = 1600
const THUMB_WIDTH = 640
const THUMB_MAX_HEIGHT = 1600
/** Images above this many pixels are sized but never decoded. */
const MAX_DECODE_PIXELS = 50_000_000
/**
 * HEIC photos above this many pixels are sized but never decoded: the decoder
 * holds the whole image, and its rendition, at once. A phone's largest photo
 * is under it.
 */
const MAX_HEIC_DECODE_PIXELS = 24_000_000

const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/tiff'])
/** Formats the browser cannot show, so they always get a thumbnail. */
const NEEDS_THUMB = new Set(['image/tiff'])
const HEIF_TYPES = new Set(['image/heic', 'image/heif'])

type Size = { width: number; height: number }

function u16le(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8)
}

function u24le(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)
}

function ascii(b: Uint8Array, o: number, n: number): string {
  return String.fromCharCode(...b.subarray(o, o + n))
}

/** A WebP's canvas size from its first chunk header, or null. */
export function webpSize(b: Uint8Array): Size | null {
  if (b.length < 25 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null
  const chunk = ascii(b, 12, 4)
  const d = 20
  if (chunk === 'VP8 ') {
    if (b.length < d + 10 || b[d + 3] !== 0x9d || b[d + 4] !== 0x01 || b[d + 5] !== 0x2a) {
      return null
    }
    return { width: u16le(b, d + 6) & 0x3fff, height: u16le(b, d + 8) & 0x3fff }
  }
  if (chunk === 'VP8L') {
    if (b[d] !== 0x2f) return null
    const bits = (b[d + 1]! | (b[d + 2]! << 8) | (b[d + 3]! << 16) | (b[d + 4]! << 24)) >>> 0
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X' && b.length >= d + 10) {
    return { width: u24le(b, d + 4) + 1, height: u24le(b, d + 7) + 1 }
  }
  return null
}

/**
 * A HEIF or AVIF image's size from its item properties: the largest `ispe`
 * (the primary image of a grid outsizes its tiles and thumbnails), swapped
 * when an `irot` turns it a quarter. Null when the boxes are not there.
 */
export function heifSize(b: Uint8Array): Size | null {
  const meta = findChild(b, 0, b.length, 'meta')
  if (!meta) return null
  // `meta` is a full box: version and flags before its children.
  const iprp = findChild(b, meta.start + 4, meta.end, 'iprp')
  const ipco = iprp && findChild(b, iprp.start, iprp.end, 'ipco')
  if (!ipco) return null
  let best: Size | null = null
  let quarterTurn = false
  for (const box of childBoxes(b, ipco.start, ipco.end)) {
    if (box.type === 'ispe' && box.end - box.start >= 12) {
      const size = { width: u32be(b, box.start + 4), height: u32be(b, box.start + 8) }
      if (!best || size.width * size.height > best.width * best.height) best = size
    } else if (box.type === 'irot' && box.end > box.start) {
      quarterTurn ||= (b[box.start]! & 3) % 2 === 1
    }
  }
  if (!best || !(best.width > 0 && best.height > 0)) return null
  return quarterTurn ? { width: best.height, height: best.width } : best
}

/** Size, and a thumbnail when it is warranted, for a format mupdf decodes. */
async function rasterPreview(
  bytes: Uint8Array,
  contentType: string,
  deadline: Pick<Deadline, 'check'>
): Promise<PreviewResult> {
  const mupdf = await loadMupdf()
  const image = new mupdf.Image(bytes)
  const stored = { width: image.getWidth(), height: image.getHeight() }
  destroy(image)
  if (!(stored.width > 0 && stored.height > 0)) throw new Error('Image has no pixels')

  // The image opened as a document is laid out the way it displays, with
  // its EXIF orientation applied: a quarter turn shows as swapped sides.
  const doc = mupdf.Document.openDocument(bytes, contentType)
  try {
    const page = doc.loadPage(0)
    try {
      const [x0, y0, x1, y1] = page.getBounds()
      const pageWidth = x1 - x0
      const pageHeight = y1 - y0
      if (!(pageWidth > 0 && pageHeight > 0)) throw new Error('Image has no area')
      const turned =
        stored.width !== stored.height && pageWidth > pageHeight !== stored.width > stored.height
      const size = turned ? { width: stored.height, height: stored.width } : stored

      const heavy =
        bytes.byteLength > THUMB_OVER_BYTES || Math.max(size.width, size.height) > THUMB_OVER_SIDE
      const wantThumb = heavy || NEEDS_THUMB.has(contentType)
      if (!wantThumb || size.width * size.height > MAX_DECODE_PIXELS) {
        return { status: 'ready', meta: size }
      }
      deadline.check()

      const scale = cappedRenderScale(
        pageWidth,
        pageHeight,
        Math.min(
          Math.min(THUMB_WIDTH, size.width) / pageWidth,
          Math.min(THUMB_MAX_HEIGHT, size.height) / pageHeight
        )
      )
      const photo = contentType === 'image/jpeg'
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
        !photo
      )
      const thumb: DerivedObject = photo
        ? {
            suffix: 'thumb.jpg',
            contentType: 'image/jpeg',
            bytes: pixmap.asJPEG(80).slice(),
            field: 'thumbKey',
          }
        : {
            suffix: 'thumb.png',
            contentType: 'image/png',
            bytes: pixmap.asPNG().slice(),
            field: 'thumbKey',
          }
      destroy(pixmap)
      return { status: 'ready', meta: size, derived: [thumb] }
    } finally {
      destroy(page)
    }
  } finally {
    destroy(doc)
  }
}

async function heicPreview(
  bytes: Uint8Array,
  deadline: Pick<Deadline, 'check'>
): Promise<PreviewResult> {
  // The decoder is only ever handed a photo whose size is known and capped.
  const declared = heifSize(bytes)
  if (!declared) throw new PreviewRefusedError('heic-size-unknown')
  if (declared.width * declared.height > MAX_HEIC_DECODE_PIXELS) {
    return { status: 'ready', meta: declared }
  }
  const convert = await loadDependency(
    'heic-convert',
    async () => (await import('heic-convert')).default
  )
  const output = await convert({
    buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    format: 'JPEG',
    quality: 0.85,
  })
  const jpeg = new Uint8Array(output)
  deadline.check()

  const raster = await rasterPreview(jpeg, 'image/jpeg', deadline)
  const rendition: DerivedObject = {
    suffix: 'rendition.jpg',
    contentType: 'image/jpeg',
    bytes: jpeg,
    field: 'renditionKey',
  }
  return { ...raster, derived: [rendition, ...(raster.derived ?? [])] }
}

export async function deriveImagePreview(
  bytes: Uint8Array,
  contentType: string,
  deadline: Pick<Deadline, 'check'> = NO_DEADLINE
): Promise<PreviewResult> {
  if (RASTER_TYPES.has(contentType)) return rasterPreview(bytes, contentType, deadline)
  if (HEIF_TYPES.has(contentType)) return heicPreview(bytes, deadline)
  const size =
    contentType === 'image/webp'
      ? webpSize(bytes)
      : contentType === 'image/avif'
        ? heifSize(bytes)
        : undefined
  if (size === undefined) return NOTHING_TO_DERIVE
  if (!size || !(size.width > 0 && size.height > 0)) throw new Error('Unreadable image header')
  return { status: 'ready', meta: size }
}
