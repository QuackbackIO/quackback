/**
 * The share card a link to the portal shows (1200 by 630): the page colour,
 * the brand icon, the title and the page's name, with the brand colour along
 * its foot. Drawn on the server in plain TypeScript with the bundled faces'
 * own outlines (extract/fonts/woff.ts), so no browser, native library or
 * capture service is involved. Also the favicon's square, for an icon that
 * is wider or taller than it is square.
 */
import { overlay } from '@/lib/shared/design/contrast'
import { nameInitial } from '@/lib/shared/utils/initial'
import { encodePng, type Image } from '../extract/png'
import { faceById, nearestWeight, type Face } from '../extract/fonts/faces'
import { fontFor, renderText, type Font } from '../extract/fonts/woff'

export const CARD = {
  width: 1200,
  height: 630,
  /** The margin around everything. */
  pad: 96,
  /** The icon's side. */
  icon: 144,
  /** The widest a full logo is drawn, in place of the icon, as tall as it. */
  logo: 480,
  /** The brand colour's strip along the foot. */
  foot: 12,
} as const

export interface ShareCardSpec {
  background: string
  ink: string
  accent: string
  /** Text that reads on the accent, for the initial when there is no icon. */
  accentInk: string
  title: string
  /** The page's name under the title; null on the portal's own card. */
  pageName: string | null
  /** Bundled face ids; an unknown one falls back to Inter. */
  headingFont: string
  headingWeight: number
  bodyFont: string
  icon: Image | null
  /** The icon is the full logo, drawn wider. */
  wide?: boolean
}

type Rgb = [number, number, number]

function rgb(colour: string): Rgb {
  const hex = overlay(colour, '#000000', 1)
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb
}

const INTER = faceById('inter')!

/** The face's nearest weight, or null when no file of it is here. */
function fontOf(id: string, weight: number): Font | null {
  const face: Face = faceById(id) ?? INTER
  return fontFor(face, nearestWeight(face.weights, weight)) ?? null
}

/** The first of the fonts that has every character of the text, or null. */
function drawable(text: string, fonts: Array<Font | null>): Font | null {
  const chars = [...text].filter((ch) => ch.trim())
  return (
    fonts.find((font) => font && chars.every((ch) => font.cmap.has(ch.codePointAt(0)!))) ?? null
  )
}

function fill(img: Image, x0: number, y0: number, x1: number, y1: number, colour: Rgb) {
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++)
      img.data.set([...colour, 255], (y * img.width + x) * 4)
}

/** `colour` laid over the pixel at `alpha` (0 to 1). */
function blend(img: Image, x: number, y: number, colour: Rgb, alpha: number) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= img.width || y >= img.height) return
  const o = (y * img.width + x) * 4
  const a = Math.min(1, alpha)
  for (let c = 0; c < 3; c++)
    img.data[o + c] = Math.round(colour[c]! * a + img.data[o + c]! * (1 - a))
}

/** A line of text with its baseline at `y`, cut with an ellipsis to fit `maxWidth`. */
function drawLine(
  img: Image,
  font: Font,
  sizes: readonly number[],
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  colour: Rgb
) {
  let line = renderText(font, sizes[0]!, text)
  for (const size of sizes) {
    line = renderText(font, size, text)
    if (line.advance <= maxWidth) break
  }
  const size = sizes[sizes.length - 1]!
  if (line.advance > maxWidth) {
    const chars = [...text]
    while (chars.length > 1 && line.advance > maxWidth) {
      chars.pop()
      line = renderText(font, size, `${chars.join('').trimEnd()}…`)
    }
  }
  const { w, h, a } = line.mask
  const top = y - line.baseline
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) blend(img, x + i, top + j, colour, a[j * w + i]!)
}

/** Coverage of a rounded square of side `size` at a pixel inside it. */
function roundedCoverage(px: number, py: number, size: number, radius: number): number {
  const cx = Math.min(Math.max(px, radius), size - radius)
  const cy = Math.min(Math.max(py, radius), size - radius)
  const d = Math.hypot(px - cx, py - cy)
  return Math.min(1, Math.max(0, radius - d + 0.5))
}

/** The image scaled to fit a box, kept in proportion, its pixels averaged when shrunk. */
function fitInto(src: Image, box: number, boxHeight = box): { img: Image; x: number; y: number } {
  const scale = Math.min(box / src.width, boxHeight / src.height)
  const w = Math.max(1, Math.round(src.width * scale))
  const h = Math.max(1, Math.round(src.height * scale))
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x / scale)
      const sy0 = Math.floor(y / scale)
      const sx1 = Math.max(sx0 + 1, Math.min(src.width, Math.floor((x + 1) / scale)))
      const sy1 = Math.max(sy0 + 1, Math.min(src.height, Math.floor((y + 1) / scale)))
      // Premultiplied, so clear pixels do not darken the edges.
      let r = 0
      let g = 0
      let b = 0
      let al = 0
      let n = 0
      for (let sy = sy0; sy < sy1; sy++)
        for (let sx = sx0; sx < sx1; sx++) {
          const o = (Math.min(sy, src.height - 1) * src.width + Math.min(sx, src.width - 1)) * 4
          const pa = src.data[o + 3]! / 255
          r += src.data[o]! * pa
          g += src.data[o + 1]! * pa
          b += src.data[o + 2]! * pa
          al += pa
          n++
        }
      const o = (y * w + x) * 4
      if (al > 0) out.set([r / al, g / al, b / al, (al / n) * 255].map(Math.round), o)
    }
  return {
    img: { width: w, height: h, data: out },
    x: Math.floor((box - w) / 2),
    y: Math.floor((boxHeight - h) / 2),
  }
}

/** What the initial tile shows: the brand colour, and the title's initial in its ink. */
export interface InitialTileSpec {
  accent: string
  accentInk: string
  headingFont: string
  headingWeight: number
  initial: string
}

/** The tile's corner radius: 28 on the card's 144px icon, in proportion at any size. */
const tileRadius = (side: number) => Math.round((side * 28) / 144)

/** The brand colour's rounded square with the initial centred, as the header draws it without an icon. */
function tileAt(
  img: Image,
  left: number,
  top: number,
  side: number,
  spec: InitialTileSpec,
  fonts: Array<Font | null>
) {
  const accent = rgb(spec.accent)
  const radius = tileRadius(side)
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++)
      blend(img, left + x, top + y, accent, roundedCoverage(x + 0.5, y + 0.5, side, radius))
  const { initial } = spec
  const font = initial ? drawable(initial, fonts) : null
  if (!font) return
  const size = Math.round((side * 88) / 144)
  const drawn = renderText(font, size, initial)
  const x = left + Math.round((side - drawn.advance) / 2)
  const capHeight = size * 0.7
  drawLine(
    img,
    font,
    [size],
    initial,
    x,
    top + Math.round((side + capHeight) / 2),
    side,
    rgb(spec.accentInk)
  )
}

/** The favicon and email header for a brand without an icon: its initial tile on clear. */
export function drawInitialTile(spec: InitialTileSpec, size: number): Image {
  const img: Image = { width: size, height: size, data: new Uint8Array(size * size * 4) }
  // Drawn on the brand colour, then its rounded edge becomes the clear around it.
  fill(img, 0, 0, size, size, rgb(spec.accent))
  tileAt(img, 0, 0, size, spec, [
    fontOf(spec.headingFont, spec.headingWeight),
    fontOf('inter', spec.headingWeight),
  ])
  const radius = tileRadius(size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      img.data[(y * size + x) * 4 + 3] = Math.round(
        255 * roundedCoverage(x + 0.5, y + 0.5, size, radius)
      )
  return img
}

export function drawShareCard(spec: ShareCardSpec): Image {
  const { width, height, pad, icon: side, foot } = CARD
  const img: Image = { width, height, data: new Uint8Array(width * height * 4) }
  const background = rgb(spec.background)
  const ink = rgb(spec.ink)
  const accent = rgb(spec.accent)
  fill(img, 0, 0, width, height, background)
  fill(img, 0, height - foot, width, height, accent)

  const heading = fontOf(spec.headingFont, spec.headingWeight)
  const fallback = fontOf('inter', spec.headingWeight)

  if (spec.icon) {
    // A full logo in place of an icon has a wider box, and starts at the margin.
    const fitted = spec.wide
      ? { ...fitInto(spec.icon, CARD.logo, side), x: 0 }
      : fitInto(spec.icon, side)
    const { img: icon } = fitted
    for (let y = 0; y < icon.height; y++)
      for (let x = 0; x < icon.width; x++) {
        const o = (y * icon.width + x) * 4
        const colour: Rgb = [icon.data[o]!, icon.data[o + 1]!, icon.data[o + 2]!]
        blend(img, pad + fitted.x + x, pad + fitted.y + y, colour, icon.data[o + 3]! / 255)
      }
  } else {
    tileAt(img, pad, pad, side, { ...spec, initial: nameInitial(spec.title) }, [heading, fallback])
  }

  const maxWidth = width - 2 * pad
  const titleFont = spec.title.trim() ? drawable(spec.title, [heading, fallback]) : null
  // A page name no face can draw is left off, and the title sits as on the portal's own card.
  const body = spec.pageName
    ? drawable(spec.pageName, [fontOf(spec.bodyFont, 400), fontOf('inter', 400)])
    : null
  const titleBaseline = body ? 392 : 430
  if (titleFont)
    drawLine(img, titleFont, [84, 76, 68, 60], spec.title.trim(), pad, titleBaseline, maxWidth, ink)
  if (body && spec.pageName) {
    const muted = rgb(overlay(spec.ink, spec.background, 0.72))
    drawLine(img, body, [44], spec.pageName, pad, 480, maxWidth, muted)
  }
  return img
}

export const encodeShareCard = (img: Image): Uint8Array => encodePng(img)

/** An icon fitted into a clear square of `size`, so a favicon is never squashed. */
export function drawSquareIcon(icon: Image, size: number): Image {
  const fitted = fitInto(icon, size)
  const out: Image = { width: size, height: size, data: new Uint8Array(size * size * 4) }
  for (let y = 0; y < fitted.img.height; y++) {
    const from = y * fitted.img.width * 4
    out.data.set(
      fitted.img.data.subarray(from, from + fitted.img.width * 4),
      ((fitted.y + y) * size + fitted.x) * 4
    )
  }
  return out
}
