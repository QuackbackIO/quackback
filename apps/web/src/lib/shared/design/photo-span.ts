/**
 * A hero photo running up behind the header (a site whose header sits on its
 * hero photo): one picture sized to cover the header and the band together,
 * placed toward the design's focal point, the header showing its top and the
 * band the rest. The band measures and publishes these as CSS properties
 * (portal-band), which the header and the band both draw with.
 */

export interface PhotoSpanInput {
  /** The picture's own size. */
  natural: { width: number; height: number }
  /** The page's width and the band's and header's heights, CSS px. */
  width: number
  band: number
  header: number
  /** The focal point, percent across and down. */
  focus: { x: number; y: number }
}

export interface PhotoSpan {
  /** background-size for both. */
  size: string
  /** background-position in the header, and in the band below it. */
  header: string
  band: string
}

const px = (n: number) => `${Math.round(n)}px`

export function photoSpan(input: PhotoSpanInput): PhotoSpan {
  const { natural, width, band, header, focus } = input
  const tall = band + header
  const scale = Math.max(width / Math.max(1, natural.width), tall / Math.max(1, natural.height))
  const w = natural.width * scale
  const h = natural.height * scale
  const x = ((width - w) * focus.x) / 100
  const y = ((tall - h) * focus.y) / 100
  return {
    size: `${px(w)} ${px(h)}`,
    header: `${px(x)} ${px(y)}`,
    band: `${px(x)} ${px(y - header)}`,
  }
}

const SIDES: Record<string, number> = { left: 0, center: 50, centre: 50, right: 100 }

/** The focus token (--qb-image-focus: "63% 20%", or a side) as a point. */
export function focusPoint(token: string): { x: number; y: number } {
  const parts = token.trim().split(/\s+/).filter(Boolean)
  const read = (part: string | undefined) =>
    part === undefined ? 50 : part.endsWith('%') ? Number.parseFloat(part) : (SIDES[part] ?? 50)
  return { x: read(parts[0]), y: read(parts[1]) }
}
