/**
 * What the canvas draws, where it is not what a row stores: a headline's
 * size is its widest and smaller on a smaller screen, and a text colour is
 * moved until it reads on what is under it. The row shows it on a muted
 * second line with "Use this", which stores the value in use.
 */
import { oklchToHex } from '@/lib/shared/theme/colors'
import { STYLE_PROPS, type StyleProp } from './style-tokens'

/** The widths the canvas draws at. */
export type DrawnSize = 'desktop' | 'tablet' | 'phone'

const hex2 = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0')

/** A colour as a browser computes it, as #rrggbb; null for one see-through or unread. */
export function cssColourHex(value: string): string | null {
  const text = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(text)) return text
  // Channels in 0-255 (or percent), then an alpha in 0-1 (or percent).
  const numbers = (inner: string) =>
    inner
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map((part, i) =>
        part.endsWith('%') ? (parseFloat(part) / 100) * (i < 3 ? 255 : 1) : parseFloat(part)
      )
  const rgb = /^rgba?\((.*)\)$/.exec(text)
  if (rgb) {
    const [r, g, b, a = 1] = numbers(rgb[1]!)
    if ([r, g, b].some((n) => n === undefined || Number.isNaN(n)) || a < 1) return null
    return `#${hex2(r!)}${hex2(g!)}${hex2(b!)}`
  }
  const srgb = /^color\(srgb\s+(.*)\)$/.exec(text)
  if (srgb) {
    const [r, g, b, a = 1] = srgb[1]!
      .split(/[\s/]+/)
      .filter(Boolean)
      .map(parseFloat)
    if ([r, g, b].some((n) => n === undefined || Number.isNaN(n)) || a! < 1) return null
    return `#${hex2(r! * 255)}${hex2(g! * 255)}${hex2(b! * 255)}`
  }
  if (text.startsWith('oklch(')) {
    const alpha = /\/\s*([\d.]+)(%?)\s*\)$/.exec(text)
    if (alpha && parseFloat(alpha[1]!) / (alpha[2] ? 100 : 1) < 1) return null
    return oklchToHex(text).toLowerCase()
  }
  return null
}

/** Two colours a browser may round apart by a step: the same to the eye. */
function sameColour(a: string, b: string): boolean {
  const channels = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [channels(a), channels(b)]
  return x.every((n, i) => Math.abs(n - y[i]!) <= 2)
}

const WHERE: Record<DrawnSize, string> = {
  phone: 'on this phone',
  tablet: 'on this tablet',
  desktop: 'at this width',
}

/** How near a drawn number must be to the stored one to be the same, by property. */
const NEAR: Partial<Record<StyleProp, number>> = {
  tracking: 0.005,
  leading: 0.05,
  opacity: 0.05,
}

export interface InUseNote {
  /** The second line: "56 max · 31 on this phone", "Shown as #8F8F8F so it reads". */
  text: string
  /** What "Use this" stores. */
  value: number | string
}

export function inUseNote({
  prop,
  stored,
  drawn,
  size,
  colourHex,
}: {
  prop: StyleProp
  /** What the row has: the value set here, else the one it inherits. */
  stored: unknown
  /** What the canvas draws the picked element with. */
  drawn: number | string | undefined
  size: DrawnSize
  /** A stored colour (a hex or a role's name) as #rrggbb, where it can be read. */
  colourHex: (colour: string) => string | null
}): InUseNote | null {
  const info = STYLE_PROPS[prop]
  if (info.kind === 'number') {
    if (typeof stored !== 'number' || typeof drawn !== 'number') return null
    const px = info.unit === 'px'
    const near = NEAR[prop]
    const differs = near
      ? Math.abs(stored - drawn) >= near
      : Math.round(stored) !== Math.round(drawn)
    if (!differs) return null
    const value = px || !near ? Math.round(drawn) : +drawn.toFixed(3)
    if (prop === 'size' && drawn < stored)
      return { text: `${Math.round(stored)} max · ${value} ${WHERE[size]}`, value }
    return { text: `Shown as ${value}`, value }
  }
  if (info.kind === 'colour' || info.kind === 'paint') {
    if (typeof stored !== 'string' || typeof drawn !== 'string') return null
    const was = colourHex(stored)
    const now = cssColourHex(drawn)
    if (!was || !now || sameColour(was, now)) return null
    const shown = now.toUpperCase()
    return {
      text: prop === 'color' ? `Shown as ${shown} so it reads` : `Shown as ${shown}`,
      value: now,
    }
  }
  return null
}
