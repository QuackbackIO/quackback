/**
 * Whether a logo shows on a surface, from the inks it is drawn in: each ink
 * with the share of the logo's pixels it draws, as the browser reader counts
 * them (logo-ink-count.ts), or as the editor counts them for an uploaded logo. The share of the logo in inks that stand
 * off the surface is how much of it can be seen there.
 */
import { luminance } from './colour-setters'

export interface LogoInkShare {
  /** `#rrggbb`. */
  color: string
  share: number
  /** The box round this ink's pixels: `[left, top, right, bottom]` in shares of the logo. */
  box?: readonly number[]
  /** The picture's own ground (the ink at all four corners): a plate the logo sits on. */
  plate?: boolean
}

/** Below this contrast with the surface an ink does not show (white on white). */
export const INK_SHOWS = 1.6
/** A logo shows when at least this share of it is drawn in inks that do. */
export const LOGO_SHOWN_SHARE = 0.5
/**
 * Or when the inks that show reach across this share of its width and of its
 * height: a drawing whose light fills vanish still shows by its outlines (a
 * white-bodied animal drawn in black), where a wordmark that vanishes beside
 * its mark leaves most of the logo's width empty.
 */
export const LOGO_SHOWN_EXTENT = 0.7

const HEX = /^#[\da-f]{6}$/i
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** The share of the logo drawn in inks that stand off `surface`, 0 to 1 of what was counted. */
export function inkShown(inks: readonly LogoInkShare[], surface: string): number {
  const counted = inks.filter((ink) => HEX.test(ink.color) && ink.share > 0)
  const total = counted.reduce((sum, ink) => sum + ink.share, 0)
  if (total === 0 || !HEX.test(surface)) return 0
  const shown = counted
    .filter((ink) => contrast(ink.color, surface) >= INK_SHOWS)
    .reduce((sum, ink) => sum + ink.share, 0)
  return shown / total
}

/**
 * Whether enough of the logo shows on `surface`. Undefined when no inks were
 * counted: the caller falls back to what the logo's markup says.
 */
export function logoShowsOn(
  inks: readonly LogoInkShare[] | undefined,
  surface: string
): boolean | undefined {
  if (!HEX.test(surface)) return undefined
  // A picture's own ground that melts into the surface is not the logo: a
  // logo on a white plate shows on a white page by everything else in it.
  const counted = (inks ?? []).filter(
    (ink) =>
      HEX.test(ink.color) &&
      ink.share > 0 &&
      !(ink.plate && contrast(ink.color, surface) < INK_SHOWS)
  )
  if (counted.length === 0) return undefined
  if (inkShown(counted, surface) >= LOGO_SHOWN_SHARE) return true
  return inkExtent(counted, surface) >= LOGO_SHOWN_EXTENT
}

type Box = readonly [number, number, number, number]
const boxOf = (ink: LogoInkShare): Box | null =>
  ink.box?.length === 4 && ink.box.every((n) => Number.isFinite(n)) ? (ink.box as Box) : null
const around = (boxes: Box[]): Box | null =>
  boxes.length === 0
    ? null
    : [
        Math.min(...boxes.map((b) => b[0])),
        Math.min(...boxes.map((b) => b[1])),
        Math.max(...boxes.map((b) => b[2])),
        Math.max(...boxes.map((b) => b[3])),
      ]

/**
 * How far across the logo the inks that stand off `surface` reach: the lesser
 * of the share of its width and of its height their pixels span. 0 when the
 * inks came without their places, or none shows.
 */
export function inkExtent(inks: readonly LogoInkShare[], surface: string): number {
  const placed = inks.flatMap((ink) => {
    const box = HEX.test(ink.color) && ink.share > 0 ? boxOf(ink) : null
    return box ? [{ ink, box }] : []
  })
  if (placed.length === 0 || placed.length < inks.length || !HEX.test(surface)) return 0
  const all = around(placed.map(({ box }) => box))
  const shown = around(
    placed.filter(({ ink }) => contrast(ink.color, surface) >= INK_SHOWS).map(({ box }) => box)
  )
  if (!all || !shown) return 0
  const [width, height] = [all[2] - all[0], all[3] - all[1]]
  if (width <= 0 || height <= 0) return 0
  return Math.min((shown[2] - shown[0]) / width, (shown[3] - shown[1]) / height)
}
