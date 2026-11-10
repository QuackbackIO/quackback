/**
 * Screenshots read in the browser, each decoded once on a canvas: a JPEG for
 * Quackback AI to look at; for the server's measuring tools, the page at its
 * CSS-pixel width (a retina capture halved exactly) and the top of the page
 * at its own resolution, lossless, for the logo and the font stage; and
 * pixels at a measuring size, kept in the browser, for the dimming check
 * before sending.
 */
import { keyOutGround, looksDimmed, type ShotBox } from '@/lib/shared/design/brand-shots'
import { imageForModel } from './image-palette'

/**
 * Pixels read along a screenshot's width. A browser averages pixels as it
 * scales an image down, so at a third of a 1440 screenshot a small logo or
 * link blends into what is around it (a homeware site's blue read as a pale blue);
 * two thirds keeps their own colours.
 */
const MEASURE_WIDTH = 960

/** At this width or more a screenshot is a retina capture, at twice its CSS pixels (as the server reads it). */
const RETINA_FROM = 2400
/** The analysis image's height at most, in CSS px: the page as a visitor first sees it, and well below. */
const ANALYSIS_MAX_HEIGHT = 2400
/**
 * The strip's heights tried, in CSS px, tallest first: the first screen (the
 * logo, the headline and its subtitle, which the font stage reads at full
 * resolution), then less of it, then the header alone.
 */
const STRIP_HEIGHTS = [900, 750, 600, 360, 200] as const
/** The strip's data URL at most, in characters (the server's bound). */
export const STRIP_MAX_CHARS = 7_000_000
/** JPEG quality of the analysis image: high, as colours and edges are measured from it. */
const ANALYSIS_QUALITY = 0.92
/**
 * The first screen at its own resolution, for a hero photo the strip does
 * not hold (a photo-heavy strip is too large as PNG and falls back to a
 * shorter one): its height in CSS px, its widest, the JPEG qualities tried,
 * and its data URL at most (the server's bound).
 */
const HERO_HEIGHT = 1100
const HERO_MAX_WIDTH = 3200
const HERO_QUALITIES = [0.9, 0.82, 0.72] as const
export const HERO_MAX_CHARS = 5_000_000

export interface BrandShot {
  id: string
  file: File
  /** An object URL to show it by. */
  url: string
  /** The image as Quackback AI sees it. */
  jpeg: string
  /** Its natural size, for crops. */
  width: number
  height: number
  /** RGBA pixels at the measuring size. */
  pixels: Uint8ClampedArray
  pixelWidth: number
  pixelHeight: number
  /** Whether it looks taken under a pop-up's dimming layer. */
  dimmed: boolean
  /** The page at its CSS-pixel width, JPEG, for the server's measuring tools. */
  analysis: string
  /** The top of the page at its own resolution, PNG, for the logo cut and the fonts; null when it cannot be made. */
  strip: string | null
  /** The first screen at its own resolution, JPEG, for a hero photo; null when the strip holds it. */
  hero: string | null
}

async function decode(url: string) {
  const image = new Image()
  image.src = url
  await image.decode()
  return image
}

/** A screenshot read for measuring, or null when it cannot be read. */
export async function readBrandShot(file: File): Promise<BrandShot | null> {
  const url = URL.createObjectURL(file)
  try {
    const image = await decode(url)
    const scale = Math.min(1, MEASURE_WIDTH / Math.max(image.naturalWidth, 1))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const jpeg = await imageForModel(file)
    if (!context || !jpeg) throw new Error('unreadable')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const { analysis, strip, hero } = forTools(image)
    if (!analysis) throw new Error('unreadable')
    return {
      id: crypto.randomUUID(),
      file,
      url,
      jpeg,
      width: image.naturalWidth,
      height: image.naturalHeight,
      pixels,
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      dimmed: looksDimmed(pixels, canvas.width, canvas.height),
      analysis,
      strip,
      hero,
    }
  } catch {
    URL.revokeObjectURL(url)
    return null
  }
}

/** The strip's first height in device px: the first screen at the capture's scale. */
export const stripHeight = (scale: number) => STRIP_HEIGHTS[0] * scale

/**
 * The tallest strip whose encoding fits the bound: each height in turn (never
 * more rows than the capture has), shortest last; null when none fits.
 */
export function tallestStrip(
  naturalHeight: number,
  scale: number,
  encode: (height: number) => string | null
): { url: string; height: number } | null {
  const heights = [...new Set(STRIP_HEIGHTS.map((h) => Math.min(naturalHeight, h * scale)))]
  for (const height of heights) {
    const url = encode(height)
    if (url && url.length <= STRIP_MAX_CHARS) return { url, height }
  }
  return null
}

/**
 * The images the server measures: the page at CSS-pixel width (a retina
 * capture halved exactly), at most 2400 CSS px tall, as a high-quality JPEG;
 * and the strip, the first screen at the capture's own resolution, as a PNG,
 * so the logo is cut, and the headline's face matched, from pixels no
 * encoder or halving has touched.
 */
function forTools(image: HTMLImageElement): {
  analysis: string | null
  strip: string | null
  hero: string | null
} {
  const scale = image.naturalWidth >= RETINA_FROM ? 2 : 1
  const width = Math.round(image.naturalWidth / scale)
  const height = Math.min(Math.round(image.naturalHeight / scale), ANALYSIS_MAX_HEIGHT)
  const page = document.createElement('canvas')
  page.width = width
  page.height = height
  const pageContext = page.getContext('2d')
  if (!pageContext) return { analysis: null, strip: null, hero: null }
  pageContext.imageSmoothingQuality = 'high'
  pageContext.fillStyle = '#ffffff'
  pageContext.fillRect(0, 0, width, height)
  pageContext.drawImage(image, 0, 0, width * scale, height * scale, 0, 0, width, height)
  const analysis = page.toDataURL('image/jpeg', ANALYSIS_QUALITY)
  const strip = tallestStrip(image.naturalHeight, scale, (rows) => {
    const top = document.createElement('canvas')
    top.width = image.naturalWidth
    top.height = rows
    const context = top.getContext('2d')
    if (!context) return null
    context.drawImage(image, 0, 0, image.naturalWidth, rows, 0, 0, image.naturalWidth, rows)
    return top.toDataURL('image/png')
  })
  const screen = heroRows(image.naturalHeight, scale)
  const hero =
    strip && strip.height >= screen
      ? null
      : boundedJpeg(screen, (quality) => {
          const width = Math.min(image.naturalWidth, HERO_MAX_WIDTH)
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = Math.round((screen * width) / image.naturalWidth)
          const context = canvas.getContext('2d')
          if (!context) return null
          context.imageSmoothingQuality = 'high'
          context.drawImage(image, 0, 0, image.naturalWidth, screen, 0, 0, width, canvas.height)
          return canvas.toDataURL('image/jpeg', quality)
        })
  return { analysis, strip: strip?.url ?? null, hero }
}

/** The first screen's rows at the capture's scale: the hero photo's whole height. */
export const heroRows = (naturalHeight: number, scale: number) =>
  Math.min(naturalHeight, HERO_HEIGHT * scale)

/** The first JPEG within the bound, at each quality in turn; null when none fits. */
export function boundedJpeg(
  rows: number,
  encode: (quality: number) => string | null
): string | null {
  if (rows <= 0) return null
  for (const quality of HERO_QUALITIES) {
    const url = encode(quality)
    if (url && url.length <= HERO_MAX_CHARS) return url
  }
  return null
}

/** Part of a screenshot at its full size, as a PNG with the page around it clear, for the portal's icon. */
export async function cropShot(shot: BrandShot, box: ShotBox): Promise<File> {
  const image = await decode(shot.url)
  const x = Math.round(box.x * shot.width)
  const y = Math.round(box.y * shot.height)
  const w = Math.max(1, Math.round(box.w * shot.width))
  const h = Math.max(1, Math.round(box.h * shot.height))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const context = canvas.getContext('2d')
  context?.drawImage(image, x, y, w, h, 0, 0, w, h)
  // The page around the logo made clear, so a dark header does not show a slab of it.
  if (context) {
    const pixels = context.getImageData(0, 0, w, h)
    if (keyOutGround(pixels.data, w, h)) context.putImageData(pixels, 0, 0)
  }
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'))
  if (!blob) throw new Error('The icon could not be cut from the image.')
  return new File([blob], 'icon.png', { type: 'image/png' })
}
