/**
 * What to do with a logo cutout: its kind (icon, wordmark, icon and name)
 * and where it goes, the tile it needs on a header it would vanish on, and
 * which screenshot to cut it from when several are sent.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { oklab, type RGB } from './color'
import type { Box, LogoKind } from './kinds'
import { cutLogo, type LogoCut } from './logo'
import { luminance, reads } from './logo-measure'
import type { Image } from './png'

/** The kind of logo cut: the finder's reading, unless the cutout's shape plainly says otherwise. */
export function logoKind(
  cut: LogoCut,
  observed?: LogoKind | null
): Exclude<LogoKind, 'not_visible'> {
  const { aspect, leadingMark } = cut.geometry
  const shape = aspect <= 1.6 ? 'icon' : leadingMark ? 'icon_and_name' : 'wordmark'
  if (!observed || observed === 'not_visible') return shape
  if (aspect <= 1.3) return 'icon'
  if (observed === 'icon' && aspect >= 2) return shape
  return observed
}

export interface LogoPlacement {
  kind: Exclude<LogoKind, 'not_visible'>
  /** A wordmark or a symbol with its name is the full logo; a symbol alone is the icon beside the title. */
  use: 'full_logo' | 'icon_and_title'
}

export function logoPlacement(cut: LogoCut, observed?: LogoKind | null): LogoPlacement {
  const kind = logoKind(cut, observed)
  return { kind, use: kind === 'icon' ? 'icon_and_title' : 'full_logo' }
}

/**
 * When the logo would vanish on the portal's header colour, the tile it needs
 * behind it ('light' or 'dark'); null when it reads as it is.
 */
export function logoTile(cut: LogoCut, header: RGB): 'light' | 'dark' | null {
  if (reads(cut.outline, header)) return null
  if (cut.readsOnLight && !cut.readsOnDark) return 'light'
  if (cut.readsOnDark && !cut.readsOnLight) return 'dark'
  return luminance(header) > 0.4 ? 'dark' : 'light'
}

/** From this many separate pieces of ink, a cut may be noise rather than a mark. */
const NOISE_PIECES = 60
/** ... when its pieces are this small on average, as a share of the cut's height squared. */
const NOISE_PIECE_AREA = 0.05

/**
 * A cut whose ink is noise, not a mark: nothing kept at all, or many small
 * scattered pieces (a grainy or textured background taken for ink) where a
 * logo has a few letters or shapes of a size with its height.
 */
export function noiseInk(cut: LogoCut): boolean {
  if (cut.clean && cut.components === 0) return true
  if (cut.components < NOISE_PIECES) return false
  const { data } = cut.image
  let solid = 0
  for (let i = 3; i < data.length; i += 4) if (data[i]! >= 128) solid++
  const h = Math.max(1, cut.bounds[3] - cut.bounds[1])
  return solid / cut.components < NOISE_PIECE_AREA * h * h
}

/** At least this share of a logo's solid pixels in one colour, it is one ink. */
const ONE_INK = 0.9
/** OKLab chroma under which a logo's colour is black, white or grey. */
const NEUTRAL = 0.04

/**
 * The logo is one ink throughout (a black, white or single-colour mark), or
 * black and white with no colour (a black mark with a white face), so it can
 * be drawn reversed where its own colour would vanish; a logo of several
 * colours cannot.
 */
export function logoOneInk(cut: LogoCut): boolean {
  if ((cut.palette[0]?.share ?? 0) >= ONE_INK) return true
  return (
    cut.palette.length > 0 &&
    cut.palette.every(({ rgb }) => {
      const [, a, b] = oklab(rgb)
      return Math.hypot(a, b) < NEUTRAL
    })
  )
}

export interface LogoSource {
  image: Image
  /** The finder's snapped logo box in this image, or null. */
  box: Box | null
  /** The finder saw a pop-up's dark layer over the page. */
  dimmed?: boolean
  /** The finder saw a cookie or consent banner. */
  banner?: boolean
  scale?: number
  /** What the finder read the logo as. */
  kind?: LogoKind | null
}

/** Under this aspect a cut stands taller than wide. */
const PORTRAIT = 0.75

/**
 * A cut that would be an unreadable sliver in the header: a name standing
 * upright (a rotated or stacked wordmark, set down a page's side) drawn in a
 * slot made for a line of type. The title stands in for it. A tall symbol is
 * still an icon.
 */
export function unreadableCut(cut: LogoCut, kind?: LogoKind | null): boolean {
  return cut.geometry.aspect < PORTRAIT && (kind === 'wordmark' || kind === 'icon_and_name')
}

export interface LogoChoice {
  index: number
  cut: LogoCut
  /** The chosen image looks dimmed too (no clean one was sent). */
  dimmed: boolean
  /** Per source: why it lost or won. */
  notes: string[]
}

/**
 * The screenshot to cut the logo from: never a dimmed one when a clean one
 * exists (dimming seen by the finder, or measured: the same logo with its
 * background and ink darkened by one factor), then a flat background over a
 * busy one, then the most logo pixels. A cut whose ink is noise is never
 * taken.
 */
export function chooseLogoSource(sources: LogoSource[]): LogoChoice | null {
  const cuts = sources.map((src) => {
    const cut = src.box ? cutLogo(src.image, src.box, { scale: src.scale }) : null
    // Noise, or a name that would be a sliver, is no logo: the title stands in for it.
    return cut && !noiseInk(cut) && !unreadableCut(cut, src.kind) ? cut : null
  })
  const dimmed = sources.map((src, i) => {
    if (src.dimmed) return true
    const a = cuts[i]
    if (!a) return false
    return cuts.some((b, j) => j !== i && b !== null && darkerTwin(a, b))
  })
  let best = -1
  let bestScore = -Infinity
  const notes = sources.map((src, i) => {
    const c = cuts[i]
    if (!c) return 'no logo box'
    const h = c.bounds[3] - c.bounds[1]
    const score =
      Math.log2(Math.max(1, h)) - (dimmed[i] ? 10 : 0) - (c.clean ? 0 : 3) - (src.banner ? 0.25 : 0)
    if (score > bestScore) {
      bestScore = score
      best = i
    }
    return [
      `logo ${h}px tall`,
      dimmed[i] ? (src.dimmed ? 'dimmed (seen)' : 'dimmed (measured)') : '',
      c.clean ? '' : 'busy background',
      src.banner ? 'banner' : '',
    ]
      .filter(Boolean)
      .join(', ')
  })
  if (best < 0) return null
  return { index: best, cut: cuts[best]!, dimmed: dimmed[best]!, notes }
}

/**
 * `a` is `b` under a dark layer: the same logo (similar size and hue), with
 * the background and the main ink both darker by about the same factor.
 */
function darkerTwin(a: LogoCut, b: LogoCut): boolean {
  const ha = a.bounds[3] - a.bounds[1]
  const hb = b.bounds[3] - b.bounds[1]
  const ra = ha / Math.max(1, hb)
  // Captures at another scale have another size: compare aspect instead then.
  if (Math.abs(a.geometry.aspect - b.geometry.aspect) > 0.25 * b.geometry.aspect) return false
  if (ra < 0.45 || ra > 2.2) return false
  const kb = luminance(a.background) / Math.max(1e-4, luminance(b.background))
  if (kb > 0.8) return false
  const ia = a.palette[0]
  const ib = b.palette[0]
  if (!ia || !ib) return true
  const yb = luminance(ib.rgb)
  if (yb < 0.02) return true
  const ki = luminance(ia.rgb) / yb
  const la = oklab(ia.rgb)
  const lb = oklab(ib.rgb)
  const hueA = Math.atan2(la[2], la[1])
  const hueB = Math.atan2(lb[2], lb[1])
  const chroma = Math.hypot(lb[1], lb[2])
  const dh = Math.abs(Math.atan2(Math.sin(hueA - hueB), Math.cos(hueA - hueB)))
  return Math.abs(ki - kb) < 0.3 && (chroma < 0.04 || dh < 0.5)
}
