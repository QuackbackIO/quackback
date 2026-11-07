/**
 * Measurements to design fields: a pure decision table from what the type
 * and geometry tools measured to the design's choices (type scale, heading
 * weight, tracking, case, corners, button shape, cards, density, width,
 * header, menu alignment, menu style) and the exact values a tune can carry
 * (headline size and weight, button and card corners). Each field is set only
 * from evidence and says why; a field without evidence is left out, for the
 * house default or a classifier to decide.
 *
 * Pure: imports only the design's option lists and step values.
 */
import { RADII_PX } from '../../../../shared/design/effective-values'
import { DESIGN_OPTIONS } from '../../../../shared/design/options'
import type { CardShadow } from '../../../../shared/design/tune'
import type { Corners, EdgeStyle } from './geometry'
import type { HeaderLayout, NavActive, NavText } from './header-nav'
import type { TextMetrics } from './text-metrics'

type Opt<K extends keyof typeof DESIGN_OPTIONS> = (typeof DESIGN_OPTIONS)[K][number]

export interface Measured {
  headline?: TextMetrics | null
  /**
   * Where the headline's reading was not of its words (withTypeMatch): the
   * size, CSS px, its box holds those words at, which sets the scale step alone.
   */
  headlineBlock?: number | null
  /** The next section's heading below the hero, where one showed whole. */
  sectionHeading?: TextMetrics | null
  /** The primary button's corners. */
  button?: Corners | null
  card?: { corners: Corners | null; edge: EdgeStyle | null; padding: number | null } | null
  nav?: NavActive | null
  /** The menu's text: in the page's text colour, or a softer grey. */
  navText?: NavText | null
  header?: HeaderLayout | null
  /** The ink-free gap under the headline, CSS px. */
  gapBelowHeadline?: number | null
  /** The content's width (the header's container), in CSS px and as a share of the page. */
  content?: { width: number; ratio: number } | null
}

export interface MeasuredFields {
  typeScale: Opt<'typeScale'>
  headingWeight: Opt<'headingWeight'>
  tracking: Opt<'tracking'>
  textCase: Opt<'textCase'>
  corners: Opt<'corners'>
  buttons: Opt<'buttons'>
  cards: Opt<'cards'>
  density: Opt<'density'>
  width: Opt<'width'>
  header: Opt<'header'>
  menuAlign: Opt<'menuAlign'>
  nav: Opt<'nav'>
  navText: Opt<'navText'>
}

export interface MeasuredTune {
  headline?: { size: number; weight: number; tracking?: number; leading?: number }
  /** Section headings, such as a Home block's title. */
  heading?: { size: number }
  button?: { radius: number; height?: number }
  card?: { radius?: number; border?: number; shadow?: CardShadow }
}

export interface MeasuredDesign {
  fields: Partial<MeasuredFields>
  tune: MeasuredTune
  /** The evidence behind each field set, and behind the section headings' size. */
  why: Partial<Record<keyof MeasuredFields | 'heading', string>>
}

const nearest = <T extends number>(options: readonly T[], v: number): T =>
  options.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a))

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Headline sizes (px) from which the type scale is display, and large. */
const DISPLAY_FROM = 44
const LARGE_FROM = 22

/** Content as wide as this share of the page or more reads as wide; under the narrow share, narrow. */
const WIDE_FROM = 0.97
const NARROW_UNDER = 0.7

/** A measured card: corners up to 36px on a box at least 48px each way (a rounder or smaller box is not a card). */
const isCard = (c: Corners) => !c.pill && c.radius <= 36 && c.width >= 48 && c.height >= 48

/** The gap under a headline (px) under which a page reads compact, and over which spacious. */
const GAP_COMPACT_UNDER = 8
const GAP_SPACIOUS_OVER = 72

/**
 * Letter-spacing estimates (em) from the gaps between letters scatter by about
 * 0.02 around the truth, as wide as the difference itself, and read open where
 * a site is not (X0: an email marketing site +0.087 for -0.019, a project tool and a
 * furniture retailer 0 for -0.02):
 * only a clearly tight one (at or under -0.03) sets tracking. The font
 * matcher's fit for the matched face (trackingFitted) is believed either way:
 * tight at or under -0.03, normal at or over 0, within -0.06 to +0.02em (the
 * fit is ranged for its face where it is matched); an estimate from the gaps,
 * which no face backs, goes no tighter than -0.04em.
 */
/**
 * A headline's line height (pitch over size) as it is set: the X0 dev and
 * goal headlines run 0.87 (a money transfer site) to 1.25 (a furniture
 * retailer). A pitch far outside that
 * is a misreading (lines of other text taken in), and the face's own line
 * height stays.
 */
const LEADING = { min: 0.85, max: 1.35, believed: [0.7, 1.6] } as const
const TIGHT_AT = -0.03
const NORMAL_AT = 0
const TRACKING_MAX = 0.02
const FITTED_MIN = -0.06
const GAPS_MIN = -0.04

/**
 * Section headings: a site's are marketing headings (a payments site 32px, a
 * chat app 50, a notes app 54, a money transfer site 58 on X0), while a
 * portal's title cards and blocks. The approved goal designs sized them 21
 * to 24px (the payments site 21, a bank 22, the chat app, the notes app and
 * the money transfer site 24), the house size 18, and the rig scores them against
 * the site's: so the size grows from 18 by half of how far the site's
 * exceeds it, to at most 28, within 4px of every approved design while the
 * X0 dev and goal sites' size score rises from 0.30 to 0.36. Where no
 * heading showed whole, the site's is read as 0.6 of the headline (the
 * median ratio of the dev and goal sites' second to first headings).
 */
const HEADING_BASE = 18
const HEADING_SHARE = 0.5
const HEADING_MAX = 28
const HEADING_OF_HEADLINE = 0.6

function headingSize(m: Measured): { size: number; why: string } | null {
  const h = m.headline
  const s = m.sectionHeading
  // A heading as large as the headline is not a section heading: the finder took something else.
  const lead = h?.size ?? m.headlineBlock ?? null
  const own = s && s.size >= 12 && (lead === null || s.size < lead * 0.95) ? s.size : null
  const site = own ?? (lead !== null ? lead * HEADING_OF_HEADLINE : null)
  if (site === null) return null
  const size = Math.round(
    clamp(HEADING_BASE + (site - HEADING_BASE) * HEADING_SHARE, HEADING_BASE, HEADING_MAX)
  )
  if (size <= HEADING_BASE) return null
  return {
    size,
    why:
      own !== null
        ? `section heading ${Math.round(own)}px on your site, sized for a card's title`
        : `headline ${Math.round(lead!)}px, so section headings a step up, sized for a card's title`,
  }
}

/**
 * A shadow's reach below its card (edgeStyle's depth, CSS px) to the step
 * whose own drawing reaches nearest, in ratio: drawn and measured as the tool
 * reads a screenshot, soft reaches 3px, lifted 7, floating 18 and deep 51, so
 * the steps part at their geometric means. Synthetic shadows as the X0 sites
 * set them read 14 to 57 (a furniture retailer 16, a
 * travel site 36, a code editor 56), a food delivery site's hairline 3.
 */
const LIFTED_FROM = 4.6
const FLOATING_FROM = 11.2
const DEEP_FROM = 30.3

export function shadowStep(depth: number): Exclude<CardShadow, 'none'> {
  if (depth < LIFTED_FROM) return 'soft'
  if (depth < FLOATING_FROM) return 'lifted'
  return depth < DEEP_FROM ? 'floating' : 'deep'
}

/** How much rounder than a rounded button its cards are drawn where no card was seen, and the most. */
const CARD_ROUNDER = 4
const CARD_ROUNDER_MAX = 24

/** Card corners to the corners step whose card radius is nearest (0, 6, 12, 20 px). */
function cornersFromCard(r: number): Opt<'corners'> {
  const steps = DESIGN_OPTIONS.corners.map((c) => [c, RADII_PX[c].panel] as const)
  return steps.reduce((a, b) => (Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a))[0]
}

const scaleStep = (size: number): Opt<'typeScale'> =>
  size >= DISPLAY_FROM ? 'display' : size >= LARGE_FROM ? 'large' : 'standard'

export function designFromMeasures(m: Measured): MeasuredDesign {
  const fields: Partial<MeasuredFields> = {}
  const why: MeasuredDesign['why'] = {}
  const tune: MeasuredTune = {}
  const h = m.headline
  if (!h && m.headlineBlock) {
    // Only the box was believed: the step its size gives, no exact size, weight or case.
    fields.typeScale = scaleStep(m.headlineBlock)
    why.typeScale = `headline box holds its words at about ${Math.round(m.headlineBlock)}px`
  }
  if (h) {
    // Type scale: a step up from the nearest, as the approved brand designs chose (a site's
    // 48px hero is display on a portal, its 24px one large); the tune keeps the exact size.
    fields.typeScale = scaleStep(h.size)
    why.typeScale = `headline ${Math.round(h.size)}px`
    fields.headingWeight = nearest(DESIGN_OPTIONS.headingWeight, h.weight)
    why.headingWeight = `headline stroke reads as weight ${Math.round(h.weight)}`
    fields.textCase = h.upper ? 'upper' : 'sentence'
    why.textCase = h.upper ? 'headline letters all capital height' : 'headline has lower case'
    const ls = h.letterSpacing
    if (ls !== null && (ls <= TIGHT_AT || (h.trackingFitted && ls >= NORMAL_AT))) {
      fields.tracking = ls <= TIGHT_AT ? 'tight' : 'normal'
      why.tracking = `headline letter-spacing about ${ls.toFixed(3)}em`
    }
    if (ls !== null && h.trackingFitted)
      why.tracking = `the headline as wide in the matched face: letter-spacing about ${ls.toFixed(3)}em`
    tune.headline = {
      size: Math.round(clamp(h.size, 10, 200)),
      weight: clamp(Math.round(h.weight / 100) * 100, 100, 900),
      ...(ls !== null && (fields.tracking || h.trackingFitted)
        ? {
            tracking: +clamp(
              Math.round(ls / 0.005) * 0.005,
              h.trackingFitted ? FITTED_MIN : GAPS_MIN,
              TRACKING_MAX
            ).toFixed(3),
          }
        : {}),
      ...(h.leading && h.leading >= LEADING.believed[0] && h.leading <= LEADING.believed[1]
        ? { leading: +clamp(h.leading, LEADING.min, LEADING.max).toFixed(2) }
        : {}),
    }
  }
  const heading = headingSize(m)
  if (heading) {
    tune.heading = { size: heading.size }
    why.heading = heading.why
  }
  const b = m.button
  if (b) {
    fields.buttons = b.pill ? 'pill' : b.radius <= 1.5 ? 'square' : 'rounded'
    why.buttons = b.pill
      ? 'main button fully round'
      : `main button corners ${b.radius.toFixed(1)}px`
    tune.button = {
      radius: b.pill ? 999 : Math.round(b.radius),
      ...(b.height >= 24 && b.height <= 72 ? { height: Math.round(b.height) } : {}),
    }
  }
  // A box the finder called a card but that does not measure as one counts as no card.
  const card = m.card?.corners && isCard(m.card.corners) ? m.card : null
  if (card?.corners) {
    fields.corners =
      card.corners.pill && card.corners.radius > 20 ? 'pill' : cornersFromCard(card.corners.radius)
    why.corners = `card corners ${card.corners.radius.toFixed(1)}px`
  } else if (b) {
    // Without a card, the button's corners: square is sharp, fully round is pill, any other
    // is subtle (the button field and its tune carry the button's own radius).
    fields.corners = b.pill ? 'pill' : b.radius <= 1.5 ? 'sharp' : 'subtle'
    why.corners = `no card seen; main button corners ${b.pill ? 'fully round' : `${b.radius.toFixed(1)}px`}`
    // A larger box is drawn rounder than the button it holds: cards a step past a rounded
    // button's corners, never the subtle step's sharper 4px.
    if (!b.pill && b.radius > 1.5)
      tune.card = { radius: Math.round(clamp(b.radius + CARD_ROUNDER, 0, CARD_ROUNDER_MAX)) }
  }
  if (card?.edge) {
    const e = card.edge
    fields.cards =
      e.kind === 'shadow'
        ? 'raised'
        : e.kind === 'border'
          ? 'bordered'
          : e.filled
            ? 'filled'
            : 'list'
    why.cards =
      e.kind === 'shadow'
        ? 'card casts a shadow'
        : e.kind === 'border'
          ? 'card has a thin edge'
          : e.filled
            ? 'card has its own colour, no edge'
            : 'card has no edge or colour of its own'
    tune.card = {
      ...(card.corners ? { radius: Math.round(clamp(card.corners.radius, 0, 48)) } : {}),
      border: e.border ? clamp(e.border.width, 0, 4) : 0,
      shadow: e.shadow ? shadowStep(e.shadow.depth) : 'none',
    }
  }
  // Density: card padding when a card is seen, else the gap under the headline relative to its size.
  if (card?.padding) {
    fields.density = card.padding < 14 ? 'compact' : card.padding > 32 ? 'spacious' : 'comfortable'
    why.density = `card padding ${Math.round(card.padding)}px`
  } else if (typeof m.gapBelowHeadline === 'number') {
    const g = m.gapBelowHeadline
    fields.density =
      g < GAP_COMPACT_UNDER ? 'compact' : g > GAP_SPACIOUS_OVER ? 'spacious' : 'comfortable'
    why.density = `gap under the headline ${Math.round(g)}px`
  }
  if (m.content) {
    // As a share of the page, so it holds whatever size the screenshot was sent at.
    const r = m.content.ratio
    fields.width = r >= WIDE_FROM ? 'wide' : r < NARROW_UNDER ? 'narrow' : 'default'
    why.width = `content ${Math.round(r * 100)}% of the page wide`
  }
  if (m.header) {
    fields.header = m.header.header
    fields.menuAlign = m.header.menuAlign
    why.header = `logo and menu boxes: ${m.header.header}`
    why.menuAlign = `menu ${m.header.menuAlign === 'centre' ? 'in the middle' : 'beside the logo'}`
  }
  if (m.navText) {
    fields.navText = m.navText.strong ? 'ink' : 'muted'
    why.navText = m.navText.strong
      ? 'menu text as dark as the page’s text'
      : 'menu text in a softer grey than the page’s text'
  }
  const nav = m.nav
  if (nav && nav.style !== 'none') {
    fields.nav =
      nav.style === 'pill'
        ? 'pills'
        : nav.style === 'tabs'
          ? 'tabs'
          : nav.style === 'underline'
            ? 'underline'
            : 'plain'
    why.nav = `current menu item marked by ${nav.style === 'plain' ? 'colour alone' : nav.style}`
  }
  return { fields, tune, why }
}
