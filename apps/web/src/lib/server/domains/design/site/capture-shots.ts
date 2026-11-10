/**
 * A captured page as the brand match takes a screenshot: what the builder
 * makes in the browser from a pasted one (lib/client/brand-shots.ts), made on
 * the server from the capture's PNG. The capture is taken at CSS-pixel scale
 * (device scale 1), so the analysis image is the page itself, the strip is
 * its top at its own resolution, and the strip holds the first screen.
 */
import { looksDimmed } from '@/lib/shared/design/brand-shots'
import type { BrandShotInput } from '../ai/brand-match'
import { decodeImage } from '../extract/image'
import { encodeJpeg } from '../extract/jpeg'
import { encodePng, type Image } from '../extract/png'

/** As the builder's: the analysis image's tallest, the strip's, and the model's longest side. */
const ANALYSIS_MAX_HEIGHT = 2400
const STRIP_HEIGHT = 900
const MODEL_SIDE = 1024
const ANALYSIS_QUALITY = 92

const dataUrl = (mime: string, bytes: Uint8Array) =>
  `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`

function rows(img: Image, height: number): Image {
  const h = Math.min(img.height, height)
  return { width: img.width, height: h, data: img.data.slice(0, img.width * h * 4) }
}

/** The image at a smaller size, each pixel the average of the source pixels it covers. */
export function shrink(img: Image, width: number, height: number): Image {
  const out = new Uint8Array(width * height * 4)
  const fx = img.width / width
  const fy = img.height / height
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * fy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * fx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx))
      let r = 0,
        g = 0,
        b = 0,
        a = 0
      for (let j = y0; j < y1; j++)
        for (let i = x0; i < x1; i++) {
          const o = (j * img.width + i) * 4
          r += img.data[o]!
          g += img.data[o + 1]!
          b += img.data[o + 2]!
          a += img.data[o + 3]!
        }
      const n = (y1 - y0) * (x1 - x0)
      const o = (y * width + x) * 4
      out[o] = Math.round(r / n)
      out[o + 1] = Math.round(g / n)
      out[o + 2] = Math.round(b / n)
      out[o + 3] = Math.round(a / n)
    }
  }
  return { width, height, data: out }
}

export interface CapturedShot {
  shot: BrandShotInput
  /** The page as a model sees it (JPEG, at most 1024 px on its longest side), for the conversation too. */
  jpeg: string
  dimmed: boolean
}

/** The capture as a brand-match screenshot, or null when its bytes are not an image. */
export function shotFromCapture(bytes: Uint8Array): CapturedShot | null {
  let img: Image
  try {
    img = decodeImage(bytes)
  } catch {
    return null
  }
  const page = rows(img, ANALYSIS_MAX_HEIGHT)
  const strip = rows(img, STRIP_HEIGHT)
  const f = Math.min(1, MODEL_SIDE / Math.max(page.width, page.height))
  const small =
    f < 1
      ? shrink(
          page,
          Math.max(1, Math.round(page.width * f)),
          Math.max(1, Math.round(page.height * f))
        )
      : page
  const pixels = new Uint8ClampedArray(small.data.buffer, small.data.byteOffset, small.data.length)
  return {
    shot: {
      analysis: dataUrl('image/jpeg', encodeJpeg(page, ANALYSIS_QUALITY)),
      strip: dataUrl('image/png', encodePng(strip)),
      width: img.width,
      height: img.height,
    },
    jpeg: dataUrl('image/jpeg', encodeJpeg(small, 85)),
    dimmed: looksDimmed(pixels, small.width, small.height),
  }
}
