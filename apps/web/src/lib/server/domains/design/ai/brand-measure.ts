/**
 * The measuring stage of a brand match: the image tools run inside the
 * element finder's snapped boxes, never a model. Colours and their roles
 * from every clean screenshot (T1), type and geometry from the screenshot
 * with the most to read (T2), the logo cut from the cleanest header strip
 * (T3), and the headline's and subtitle's faces matched to bundled fonts
 * (T4), whose cap height and weight then size the headline.
 */
import { looksDimmed } from '@/lib/shared/design/brand-shots'
import { logoInk } from '@/lib/shared/design/logo'
import type { FoundElements } from '../extract/finder'
import type { Box } from '../extract/kinds'
import {
  chooseLogoSource,
  logoOneInk,
  logoPlacement,
  type LogoPlacement,
} from '../extract/logo-choice'
import type { LogoCut } from '../extract/logo'
import { hex as toHex, okDist } from '../extract/color'
import { cornerRadius, edgeStyle, type Corners } from '../extract/geometry'
import { headerLayout, navActive, navText } from '../extract/header-nav'
import type { Measured } from '../extract/measured-design'
import type { Image } from '../extract/png'
import {
  colourEvidence,
  decideRoles,
  type ColourEvidence,
  type ColourRoles,
} from '../extract/roles'
import { isLightNeutral, swatchHex } from '../extract/roles-evidence'
import { solidShapes } from '../extract/shapes'
import { frameStats } from '../extract/snap'
import { boxGap, cardPadding, contentExtent, gapBelow } from '../extract/spacing'
import { measureText, type TextMetrics } from '../extract/text-metrics'
import { readPageFill, type PageFillReading } from '../extract/page-fill'
import { headlineTone, type HeadlineTone } from '../extract/headline-tone'
import { photoNotVeil } from '../extract/dim-photo'
import { lift, undimmed, veilOf } from '../extract/undim'
import type { TypeMatch } from '../extract/fonts/type-match'

/** A screenshot as the match reads it. */
export interface Shot {
  /** Its place among the images sent. */
  index: number
  /** The analysis image, at CSS-pixel size. */
  img: Image
  /** The top of the page at its own resolution, lossless, for the logo and the fonts; null when not sent. */
  strip: Image | null
  /** The first screen at its own resolution, JPEG, for a hero photo the strip does not hold; absent when not sent. */
  hero?: Image | null
  /** The screenshot's own size, which the logo's box is given in fractions of. */
  width: number
  height: number
  found: FoundElements
  /** What the builder warned about this screenshot before it was sent (and kept anyway). */
  told?: { dimmed?: boolean; banner?: boolean }
}

/** A screenshot under a pop-up's dimming or a cookie banner, by the builder's warning or the finder's reading. */
export const blemished = (shot: Shot) => isDimmed(shot) || hasBanner(shot)

const hasBanner = (shot: Shot) => !!shot.told?.banner || !!shot.found.output.cookie_banner

/**
 * A screenshot under a pop-up's dark layer, as the finder read it (unless a
 * photo hero on a light page is what it read, extract/dim-photo.ts) or its
 * pixels show it (the brightest pixels all in one panel), so one flaky
 * read alone neither misses a layer nor invents one: lifting also needs
 * the page to measure as a white page under a layer (extract/undim.ts).
 */
export function seenDimmed(shot: Shot): boolean {
  const { output, snapped } = shot.found
  // A dark photo hero the finder reads as a layer: the page around it keeps its light.
  if (output.dimmed && !photoNotVeil(shot.img, snapped, output.behind_headline)) return true
  const { data, width, height } = shot.img
  return looksDimmed(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    width,
    height
  )
}

/** Dimmed by a pop-up: as the builder warned (and the person kept it), the finder read, or the pixels show. */
export function isDimmed(shot: Shot): boolean {
  return !!shot.told?.dimmed || seenDimmed(shot)
}

/**
 * The screenshots colours, mode, the hero and the logo are read from: never
 * a dimmed one while any other shows the page, then the clean ones while
 * any is clean (a banner covers less than a dark layer changes).
 */
export function cleanShots(shots: readonly Shot[]): Shot[] {
  const lit = shots.filter((shot) => !isDimmed(shot))
  const clean = lit.filter((shot) => !hasBanner(shot))
  return clean.length ? clean : lit.length ? lit : [...shots]
}

/** Only dimmed screenshots to read from: their colours are lifted where they can be, and less sure. */
export function onlyDimmed(shots: readonly Shot[]): boolean {
  return shots.length > 0 && cleanShots(shots).every(isDimmed)
}

/** A screenshot's pixels to measure: lifted from a pop-up's dark layer where one is. */
export function measurable(shot: Shot): Image {
  return isDimmed(shot) ? undimmed(shot.img) : shot.img
}

/** The screenshot type and shape are read from: a clean one with a headline, else the first. */
export function primaryShot(shots: readonly Shot[]): Shot | null {
  const clean = cleanShots(shots)
  return clean.find((shot) => shot.found.snapped.headline) ?? clean[0] ?? null
}

export interface ColourMeasures {
  evidence: ColourEvidence
  roles: ColourRoles
}

/**
 * T1: every colour seen on purpose, where, and the five roles the rules
 * settle. A screenshot the finder saw under a pop-up's dark layer (sent
 * when no clean one was) is lifted back first, so its colours are the site's.
 */
export function measureColours(shots: readonly Shot[]): ColourMeasures {
  const evidence = colourEvidence(
    cleanShots(shots).map((shot) => {
      const img = measurable(shot)
      return {
        img,
        boxes: shot.found.snapped,
        behind: shot.found.output.behind_headline,
        // Still under its layer (too dark to lift): its page cannot tell the site's mode.
        dimmed: isDimmed(shot) && img === shot.img,
      }
    })
  )
  return { evidence, roles: decideRoles(evidence) }
}

/**
 * T1: the page behind the content in each clean screenshot, the one type
 * and shape are read from first: its colour outside the hero and the cards,
 * band by band down the screenshot, and a dark page's glow. A screenshot
 * under a pop-up's dark layer is lifted back first, as for the colours.
 */
export function measurePageFill(shots: readonly Shot[]): PageFillReading[] {
  const clean = cleanShots(shots)
  const first = primaryShot(shots)
  const ordered = first ? [first, ...clean.filter((shot) => shot !== first)] : clean
  return ordered.map((shot) =>
    readPageFill(seenDimmed(shot) ? undimmed(shot.img) : shot.img, shot.found.snapped)
  )
}

/** The header's own colour, as hex, or null without a header box. */
export function headerColour(shot: Shot): string | null {
  const box = shot.found.snapped.header
  return box ? swatchHex(frameStats(shot.img, box).colour) : null
}

/** Two fills this close (OKLab) are one button colour. */
const SAME_FILL = 0.06

const overlaps = (a: Box, b: Box | null) =>
  !!b && Math.min(a[2], b[2]) > Math.max(a[0], b[0]) && Math.min(a[3], b[3]) > Math.max(a[1], b[1])

/**
 * The main button as the site's own buttons are sized: its call to action
 * in the header, in the main button's colour (or any filled one when the
 * finder saw no main button). The finder's main button is usually the
 * hero's, drawn bigger for the campaign (X0: a payments site's 48px against its 40px
 * header button, a chat app's 57 against 42, a money transfer site's 48
 * against 32), while the rig's
 * site fingerprint, and a portal's buttons, are the header's size. Null
 * without such a button.
 */
export function headerButton(shot: Shot, main: Corners | null): Corners | null {
  return headerCta(shot, main)?.corners ?? null
}

/** The finder's main button's corners, from the strip where it lies within it: lossless, at its own resolution. */
export function mainButton(shot: Pick<Shot, 'img' | 'strip' | 'found'>): Corners | null {
  const at = sharpest(shot, shot.found.snapped.primary_button)
  return cornerRadius(at.img, at.box, { scale: at.scale })
}

/** The header's call to action: its corners, and its box and image where it was read. */
export interface HeaderCta {
  corners: Corners
  /** Its box in `img`, at `scale` image pixels per CSS px. */
  box: Box
  img: Image
  scale: number
}

export function headerCta(shot: Shot, main: Corners | null): HeaderCta | null {
  const b = shot.found.snapped
  if (!b.header) return null
  // From the header strip where it holds the header: lossless, where the builder's
  // JPEG blurs a small saturated button's fill past what solid shapes join.
  const at = sharpest(shot, b.header)
  const k = at.scale
  const near = (box: Box | null) => (box ? scaled(box, k) : null)
  const shapes = solidShapes(at.img, at.box, {
    minHeight: 22 * k,
    maxHeight: 64 * k,
    minAspect: 1.4,
    maxAspect: 8,
  }).filter(
    (s) =>
      !overlaps(s.box, near(b.logo)) &&
      !overlaps(s.box, near(b.nav_row)) &&
      !overlaps(s.box, near(b.input_field)) &&
      // A pale grey shape in a header is a search field or a menu pill.
      !isLightNeutral(s.fill) &&
      (!main || okDist(s.fill.rgb, main.edge) < SAME_FILL)
  )
  // The rightmost, where a header's call to action sits.
  const cta = shapes.sort((x, y) => y.box[2] - x.box[2])[0]
  const corners = cta ? cornerRadius(at.img, cta.box, { scale: k }) : null
  return cta && corners ? { corners, box: cta.box, img: at.img, scale: k } : null
}

/** A box this close to the screenshot's bottom edge (CSS px) may go on below it. */
const CUT_AT_BOTTOM = 4

/** The share of a box's area inside another. */
const inside = (a: Box, b: Box) =>
  (Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))) /
  Math.max(1, (a[2] - a[0]) * (a[3] - a[1]))

/**
 * The next section's heading below the hero, where the finder saw one whole:
 * not cut by the screenshot's bottom edge (its lines may go on below), below
 * the headline (above it, it is something else), and not inside a card (a
 * card's title, as one site's first card's was read).
 */
export function measureSectionHeading(
  img: Image,
  box: Box | null,
  text: string,
  headline: Box | null,
  card: Box | null = null
): TextMetrics | null {
  if (!box || box[3] >= img.height - CUT_AT_BOTTOM) return null
  if (headline && box[1] < headline[3]) return null
  if (card && inside(box, card) > 0.5) return null
  return measureText(img, box, { scale: 1, text })
}

/** T2: the headline, corners, card, menu, header, spacing and width of one screenshot. */
export function measureGeometry(shot: Shot): Measured {
  const { img } = shot
  const b = shot.found.snapped
  const scale = 1
  const headline = measureText(img, b.headline, { scale, text: shot.found.output.headline_text })
  const below = [b.subtitle, b.primary_button, b.secondary_button, b.input_field]
  const main = mainButton(shot)
  const nav = navActive(img, b.nav_row, { scale, header: b.header })
  return {
    headline,
    sectionHeading: measureSectionHeading(
      img,
      b.section_heading,
      shot.found.output.section_heading_text ?? '',
      headline?.inkBox ?? b.headline,
      b.card
    ),
    button: headerButton(shot, main) ?? main,
    card: b.card
      ? {
          corners: cornerRadius(img, b.card, { scale }),
          edge: edgeStyle(img, b.card, { scale }),
          padding: cardPadding(img, b.card, { scale }),
        }
      : null,
    nav,
    navText: navText(img, nav),
    header: headerLayout(b.logo, b.nav_row, img.width),
    gapBelowHeadline: headline
      ? (gapBelow(img, headline.inkBox, { scale }) ?? boxGap(headline.inkBox, below, { scale }))
      : null,
    content: contentExtent(
      img,
      b.header,
      [b.logo, b.nav_row, b.headline, b.primary_button, b.secondary_button],
      { scale }
    ),
  }
}

/**
 * Where a box's pixels are sharpest: the header strip, at the capture's own
 * resolution and lossless, when the box lies within it (with the box and the
 * device scale there), else the analysis image at CSS px.
 */
export function sharpest(
  shot: Pick<Shot, 'img' | 'strip'>,
  box: Box | null
): { img: Image; box: Box | null; scale: number } {
  const strip = shot.strip
  if (!box || !strip) return { img: shot.img, box, scale: 1 }
  const k = strip.width / shot.img.width
  if (box[3] * k > strip.height) return { img: shot.img, box, scale: 1 }
  return { img: strip, box: scaled(box, k), scale: k }
}

/** Whether the headline is two-tone, read from its sharpest pixels. */
export function measureTone(shot: Pick<Shot, 'img' | 'strip' | 'found'>): HeadlineTone | null {
  const at = sharpest(shot, shot.found.snapped.headline)
  return headlineTone(at.img, at.box)
}

/** A stem read under this weight is light display type (a payments site's 300). */
export const LIGHT_BELOW = 450
/** How much lighter than the fit the stem must read to be believed over it. */
const LIGHTER_BY = 30
/** How much heavier than the stem a serif's fit must read to be pulled back toward it. */
const SERIF_HEAVIER_BY = 150

/**
 * The CSS weight a headline is set in, from the stem's reading (any face,
 * the calibrated stem table) and the matched face's weight. The match fits
 * the closest bundled face to the crop's widths as well as its strokes, so a
 * brand face wider than it reads heavier in the fit: on the X0 captures
 * a payments site's Sohne 300 fitted Inter Tight at 500 (stem 432), a
 * furniture retailer's 700 at 800 (stem 737), a travel site's 500 at 600
 * (551), a file storage site's 500 at 700 (597). Where the
 * stem reads clearly lighter than the fit, on a sans, the weight is the step
 * at or below the stem, and under 450 light display type, 300.
 *
 * A serif keeps the fit, as its hairlines move the stem's reading
 * (an email marketing site's 400 read 287 to 546 by source), unless the fit is far heavier
 * than the stem: a substitute serif matched by its stems draws heavier than a
 * brand serif of higher contrast (a newspaper's 500 at 900 on gate 11-02e).
 * On the bundled serifs drawn and matched with their own face left out, the
 * stem lands within a step of the weight 95% of the time and the fit 83%
 * (Source Serif 500 fitted Merriweather 700, stem 530): such a fit takes the
 * step nearest the two readings' mean.
 */
export function headlineWeight(
  stem: number | null | undefined,
  match: Pick<TypeMatch, 'weight' | 'face'>
): number {
  if (stem == null) return match.weight
  if (match.face.top === 'serif')
    return match.weight - stem > SERIF_HEAVIER_BY
      ? Math.round((match.weight + stem) / 200) * 100
      : match.weight
  if (match.face.top !== 'sans' || stem > match.weight - LIGHTER_BY) return match.weight
  return stem < LIGHT_BELOW ? 300 : Math.floor(stem / 100) * 100
}

/**
 * The headline tracking a substitute face is given, in em: tight to slightly
 * open. A close match is the site's own design (or one like it), whose
 * drawing at the fitted tracking overlaps the crop without collisions, so it
 * may go as tight as the X0 sites do (a developer platform's Geist:
 * fitted -0.08, site -0.06).
 */
export const TRACKING_RANGE = { min: -0.04, closeMin: -0.06, max: 0.02 } as const
/** A drawing overlapping its crop this little says nothing about the spacing. */
const TRACKING_FIT_IOU = 0.5

/**
 * The letter-spacing that makes the matched face draw the headline's words
 * as wide as the screenshot shows them: the matcher's fit for that face (not
 * the site's own tracking, which belongs to the site's face), kept within
 * TRACKING_RANGE so a substitute neither collides nor spreads, and none at
 * all (the house spacing) where the drawing does not fit the crop.
 *
 * A fit far beyond the range (a money transfer site: Noto Sans 900 fitted
 * -0.13em for a site
 * at 0) says the face is too wide for the text, not that the spacing is
 * unknown: the range's end draws it nearest the screenshot's width (that site
 * 1.20 times as wide at the house -0.02em, 1.09 at -0.04em), and the face
 * choice prefers a near face that needs less (chooseFace, by width).
 */
export function fittedTracking(
  match: Pick<TypeMatch, 'tracking' | 'iou' | 'close'>
): number | null {
  const t = match.tracking
  if (!Number.isFinite(t)) return null
  if (!(match.iou >= TRACKING_FIT_IOU)) return null
  const min = match.close ? TRACKING_RANGE.closeMin : TRACKING_RANGE.min
  return +Math.min(TRACKING_RANGE.max, Math.max(min, t)).toFixed(3)
}

/** The subtitle sizes the portal sets (the tune's range). */
const SUBTITLE_PX = { min: 12, max: 32 } as const

/**
 * The subtitle's size: its matched face's size, the size that face needs to
 * draw the crop's capitals and ascenders as tall, in whole px. Without a
 * drawing that fits (word overlap under TRACKING_FIT_IOU) the size is not
 * believed, and the portal's own, grown with the headline, stays.
 */
export function subtitleSize(m: TypeMatch | null): number | null {
  if (!m || !(m.iou >= TRACKING_FIT_IOU) || !Number.isFinite(m.size)) return null
  const px = Math.round(m.size)
  return px >= SUBTITLE_PX.min && px <= SUBTITLE_PX.max ? px : null
}

/**
 * Letters this much narrower (log ratio) than the normal-width faces' are no
 * face's: half their width, where the most condensed bundled faces read -0.27
 * to -0.48 (CONDENSED_BELOW). A reading that narrow is not of the headline's
 * words at all. Its lines ran together into one tall band (artwork bridging
 * them: a delivery site's two lines beside its illustration read 133px, glyph
 * width -2.0), or its ink was a photo's dark parts rather than the lettering
 * over it (a carousel slide's white capitals read 154px at -2.4). On the
 * bench the genuine readings run -0.63 to +1.06.
 */
export const NOT_LETTERS_BELOW = Math.log(0.5)

/** A typical face's tall letters over its size, a headline's line pitch, and a letter's width with its share of the spaces, in em. */
const BLOCK = { cap: 0.73, pitch: 1.15, letter: 0.65 } as const

/**
 * The size a headline's box holds its words at, CSS px, without reading its
 * letters: set on as many lines as make the box's height and its width agree
 * (each line about the box's width, the box's height their pitch), the size
 * the height gives. On the bench's headlines read cleanly, eight in ten
 * land within -13% to +42% of the matched size (median +5%): enough for a
 * scale step, never an exact size.
 */
export function blockSize(box: Box, letters: number): number | null {
  const width = box[2] - box[0]
  const height = box[3] - box[1]
  if (!(width > 0 && height > 0 && letters > 0)) return null
  let best: { miss: number; size: number } | null = null
  for (let lines = 1; lines <= 6; lines++) {
    const byHeight = height / (BLOCK.cap + (lines - 1) * BLOCK.pitch)
    const byWidth = (lines * width) / (letters * BLOCK.letter)
    const miss = Math.abs(Math.log(byHeight / byWidth))
    if (!best || miss < best.miss) best = { miss, size: byHeight }
  }
  return best ? +best.size.toFixed(1) : null
}

/**
 * The headline as the matched face reads it: T2 sized it with a typical
 * face's cap height; the face's own cap height and the tracking the matcher
 * fitted for it replace those guesses (fittedTracking), and the weight is
 * the lighter of the two readings (headlineWeight).
 *
 * Where the words, drawn at the size read, come out far narrower than any
 * face draws them (NOT_LETTERS_BELOW), the reading is of something else, so
 * no headline is measured: its weight, case and spacing stay the look's
 * choices rather than a block of art's, and its box gives only the scale step
 * (blockSize).
 */
export function withTypeMatch(measured: Measured, match: TypeMatch | null): Measured {
  const h = measured.headline
  if (!h || !match) return measured
  if (match.glyphWidth !== undefined && match.glyphWidth < NOT_LETTERS_BELOW)
    return {
      ...measured,
      headline: null,
      headlineBlock: match.letters ? blockSize(h.inkBox, match.letters) : null,
    }
  // The section heading is set in the headline's face on most sites: its cap height over that face's.
  const s = measured.sectionHeading
  return {
    ...measured,
    ...(s && match.capRatio > 0
      ? { sectionHeading: { ...s, size: s.capHeight / match.capRatio } }
      : {}),
    headline: {
      ...h,
      size: match.size,
      // The stem as the match read it from the lossless strip; the analysis JPEG's, without.
      weight: headlineWeight(Number.isFinite(match.stem) ? match.stem : h.weight, match),
      letterSpacing: fittedTracking(match),
      trackingFitted: true,
      capRatio: match.capRatio,
      leading: h.lineHeight ? +(h.lineHeight / match.size).toFixed(3) : h.leading,
    },
  }
}

export interface FoundLogo {
  /** The screenshot it was cut from. */
  index: number
  cut: LogoCut
  placement: LogoPlacement
  /** The cutout's ink, dark or light throughout, or null. */
  tone: 'dark' | 'light' | null
  /** The cutout is one ink, so it can be redrawn reversed where it would vanish. */
  oneInk: boolean
  /** That ink's colour, when it is one ink. */
  ink: string | null
  /** Where it sits in its screenshot, as fractions of the screenshot's size. */
  box: { x: number; y: number; w: number; h: number }
}

const scaled = (box: Box, k: number): Box => [
  Math.round(box[0] * k),
  Math.round(box[1] * k),
  Math.round(box[2] * k),
  Math.round(box[3] * k),
]

/**
 * T3: the logo cut from the cleanest screenshot, from its header strip at
 * its own resolution where the logo lies within the strip, else from the
 * analysis image.
 */
export function cutBrandLogo(shots: readonly Shot[]): FoundLogo | null {
  const sources = shots.map((shot) => {
    const at = sharpest(shot, shot.found.snapped.logo)
    // Under a pop-up's dark layer a white logo reads grey: lifted, as the colours are.
    const veil = isDimmed(shot) ? veilOf(shot.img) : null
    return {
      image: veil
        ? lift(at.img, { ...veil, panel: at.img === shot.img ? veil.panel : null })
        : at.img,
      box: at.box,
      scale: at.scale,
      dimmed: isDimmed(shot),
      banner: hasBanner(shot),
      kind: shot.found.output.logo_kind,
    }
  })
  const choice = chooseLogoSource(sources)
  if (!choice) return null
  const shot = shots[choice.index]!
  const source = sources[choice.index]!.image
  // The cut's bounds in the screenshot's own pixels, then as fractions of it.
  const k = shot.width / source.width
  const [x0, y0, x1, y1] = choice.cut.bounds
  const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000
  const { image } = choice.cut
  return {
    index: shot.index,
    cut: choice.cut,
    placement: logoPlacement(choice.cut, shot.found.output.logo_kind),
    tone: logoInk(
      new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.length)
    ),
    oneInk: logoOneInk(choice.cut),
    ink: logoOneInk(choice.cut) && choice.cut.palette[0] ? toHex(choice.cut.palette[0].rgb) : null,
    box: {
      x: round((x0 * k) / shot.width),
      y: round((y0 * k) / shot.height),
      w: round(((x1 - x0) * k) / shot.width),
      h: round(((y1 - y0) * k) / shot.height),
    },
  }
}
