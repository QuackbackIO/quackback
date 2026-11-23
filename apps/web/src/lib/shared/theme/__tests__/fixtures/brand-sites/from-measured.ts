/**
 * The measured sites (measured.json, written by measure.mjs from a headless
 * browser's computed styles) as `BrandRead`s, by one mechanical rule, so the
 * fixtures say only what was measured:
 *
 * - page background: the body's (or the root's) background; fully
 *   transparent stays `transparent`.
 * - page text: the body's text colour, a translucent one laid over the page.
 * - button: the first filled button measured (consent buttons were already
 *   left out), its fill, ink, height and radius as given (px or %).
 * - fonts: the body's stack, and the largest heading's as the headline.
 * - logo: the first image or inline SVG in the header, by its drawn size.
 * - nothing else (no card radius, no palette) was measured.
 */
import type { BrandRead, Hex } from '@/lib/shared/theme/brand-import'

export interface MeasuredSite {
  title: string
  themeColor: string | null
  bg: string
  text: string
  bodyFont: string
  h1: { font: string } | null
  buttons: Array<{ bg: string; fg: string; radius: string; h: number }>
  logo: { tag: string; w: number; h: number } | null
}

type Rgba = [number, number, number, number]

function rgba(value: string): Rgba | null {
  const match = /^rgba?\(([^)]*)\)$/.exec(value.trim())
  if (match) {
    const parts = match[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number)
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null
    return [parts[0], parts[1], parts[2], parts[3] ?? 1]
  }
  const hex = /^#([\da-f]{6})$/i.exec(value.trim())
  if (!hex) return null
  const n = parseInt(hex[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
}

const toHex = ([r, g, b]: Rgba): Hex =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}` as Hex

/** The colour as drawn over `under` (white when the page is transparent). */
function over(value: string, under: Rgba = [255, 255, 255, 1]): Hex | undefined {
  const colour = rgba(value)
  if (!colour) return undefined
  const mix = (i: 0 | 1 | 2) => colour[i] * colour[3] + under[i] * (1 - colour[3])
  return toHex([mix(0), mix(1), mix(2), 1])
}

export function brandReadFromMeasured(site: MeasuredSite): BrandRead {
  const page = rgba(site.bg)
  const transparent = !page || page[3] === 0
  const under: Rgba = transparent ? [255, 255, 255, 1] : page
  const button = site.buttons[0]
  const radius = button ? /^([\d.]+)(px|%)$/.exec(button.radius.trim().split(/\s+/)[0]) : null
  const headline = site.h1?.font
  const first = (stack: string) =>
    stack
      .split(',')[0]
      .trim()
      .replace(/^["']|["']$/g, '')
  return {
    title: site.title,
    themeColor: site.themeColor ? (site.themeColor.toLowerCase() as Hex) : undefined,
    page: {
      background: transparent ? 'transparent' : toHex(page),
      text: over(site.text, under),
    },
    button: button
      ? {
          fill: over(button.bg, under),
          ink: over(button.fg, under),
          heightPx: button.h,
          ...(radius?.[2] === '%'
            ? { radiusPercent: Number(radius[1]) }
            : radius
              ? { radiusPx: Number(radius[1]) }
              : {}),
        }
      : undefined,
    fonts: {
      body: { family: first(site.bodyFont), stack: site.bodyFont },
      headline: headline ? { family: first(headline), stack: headline } : undefined,
    },
    logo: site.logo
      ? {
          widthPx: site.logo.w,
          heightPx: site.logo.h,
          from: site.logo.tag.toLowerCase() === 'svg' ? 'header-svg' : 'header-img',
        }
      : undefined,
  }
}
