/**
 * The finer exact values a tune can carry, from what the screenshot shows:
 * the subtitle's colour, the section headings' line height and colour, the
 * menu's and buttons' label size and case, and a text field's corners. Each
 * is set only from its own evidence and says why; one without evidence is
 * left out, for the house value to stand.
 *
 * Measured on the X0 goal and dev captures against each site's rendered
 * fingerprint (the rig's score): the portal drew every subtitle in a mid
 * grey (82, 82, 82) where 9 of 12 sites set theirs near their text colour,
 * every section heading at 1.56 line height where the sites run 0.94 to 1.35,
 * and every label at 13px where the sites run 13 to 18.
 *
 * Pure: imports only colour arithmetic.
 */
import { hex, oklab, type RGB } from './color'
import type { Corners } from './geometry'
import type { TextMetrics } from './text-metrics'

export interface DetailMeasures {
  /** The headline, its line height as the matched face reads it. */
  headline?: TextMetrics | null
  /** The headline's ink as the page shows it (a two-tone headline's main part). */
  headlineInk?: RGB | null
  /** The next section's heading, where one showed whole. */
  sectionHeading?: TextMetrics | null
  subtitle?: TextMetrics | null
  /** The label of the site's call to action: the header's button where there is one. */
  label?: TextMetrics | null
  /** The main button's label, read with the words the finder read in it. */
  buttonText?: TextMetrics | null
  /** A text field's corners. */
  field?: Corners | null
}

export interface MeasuredDetails {
  tune: {
    subtitle?: { colour: string }
    heading?: { leading?: number; colour?: string }
    label?: { size: number }
    field?: { radius: number }
    button?: { case: 'upper' }
  }
  why: Partial<
    Record<
      | 'subtitleColour'
      | 'headingLeading'
      | 'headingColour'
      | 'labelSize'
      | 'fieldRadius'
      | 'buttonCase',
      string
    >
  >
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * A section heading's line height: the sites' headings run 0.94 (a money transfer
 * site) to 1.35 (a code host), most within 0.1 of their headline's. Kept from 1 (a card's
 * title wraps, and tighter lines touch) to 1.35; a pitch outside 0.8 to 1.6
 * is a misreading and sets none.
 */
const HEADING_LEADING = { min: 1, max: 1.35, believed: [0.8, 1.6] } as const

/**
 * Text on the page, not on a band: its frame this light (OKLab L) and the
 * ink this dark. A headline on a coloured hero (a bank, a furniture retailer, an
 * email marketing site) is
 * drawn in the band's colours, which say nothing of the page's headings.
 */
const PAGE_FRAME_FROM = 0.9
const PAGE_INK_UNDER = 0.6

/**
 * Labels the portal sizes from 12 to 18px (the sites' menus and buttons run
 * 13 to 18 on X0); a reading outside 10 to 22 took in something else.
 */
const LABEL = { min: 12, max: 18, believed: [10, 22] } as const

/** A text field as wide and as tall as one: a box this size or more, at most this tall (CSS px). */
const FIELD = { minWidth: 120, minHeight: 28, maxHeight: 64 } as const

const onPage = (t: Pick<TextMetrics, 'frame'>, ink: RGB) =>
  oklab(t.frame)[0] >= PAGE_FRAME_FROM && oklab(ink)[0] < PAGE_INK_UNDER

const rounded = (ink: RGB): RGB => ink.map((v) => Math.round(clamp(v, 0, 255))) as RGB

export function detailsFromMeasures(m: DetailMeasures): MeasuredDetails {
  const tune: MeasuredDetails['tune'] = {}
  const why: MeasuredDetails['why'] = {}

  // The subtitle's own colour: the portal's mid grey otherwise (renderer keeps it where it reads).
  const sub = m.subtitle
  if (sub) {
    const colour = hex(rounded(sub.ink))
    tune.subtitle = { colour }
    why.subtitleColour = `the text under your headline is ${colour}`
  }

  // Section headings: their own line pitch where one showed in two lines, else the headline's.
  const s = m.sectionHeading
  const h = m.headline
  // The heading's size is the matched face's (withTypeMatch), so its pitch is read over that.
  const own = s?.lineHeight ? s.lineHeight / s.size : null
  const pitch = own ?? h?.leading ?? null
  if (
    pitch !== null &&
    pitch >= HEADING_LEADING.believed[0] &&
    pitch <= HEADING_LEADING.believed[1]
  ) {
    const leading = +clamp(pitch, HEADING_LEADING.min, HEADING_LEADING.max).toFixed(2)
    tune.heading = { leading }
    why.headingLeading = own
      ? `your section headings’ line pitch, ${own.toFixed(2)}`
      : `set as tight as your headline’s lines, ${pitch.toFixed(2)}`
  }
  // Their colour: a section heading's own ink, else the headline's where it sits on the page.
  const headlineInk = m.headlineInk ?? h?.ink ?? null
  const ownInk = s && onPage(s, s.ink) ? s.ink : null
  const ink = ownInk ?? (h && headlineInk && onPage(h, headlineInk) ? headlineInk : null)
  if (ink) {
    const colour = hex(rounded(ink))
    tune.heading = { ...tune.heading, colour }
    why.headingColour = ownInk
      ? `your section headings are set in ${colour}`
      : `your headline’s ink, ${colour}, as headings on the page`
  }

  // Labels: the call to action's letters, as the menu shares them.
  const label = m.label
  if (label && label.size >= LABEL.believed[0] && label.size <= LABEL.believed[1]) {
    const size = Math.round(clamp(label.size, LABEL.min, LABEL.max))
    tune.label = { size }
    why.labelSize = `your buttons’ labels are about ${size}px`
  }
  // Capitals: the main button's words set in capitals, read with its words (a label of
  // no tall letters is not taken for one in capitals).
  if (m.buttonText?.upper) {
    tune.button = { case: 'upper' }
    why.buttonCase = 'your main button’s label is set in capitals'
  }

  // A text field's corners, unless fully round: a round search bar is a wrapper's
  // shape (a furniture retailer, a travel site: the field inside it is square), while the portal's field
  // is its composer, a box that grows to several lines.
  const f = m.field
  if (
    f &&
    !f.pill &&
    f.width >= FIELD.minWidth &&
    f.height >= FIELD.minHeight &&
    f.height <= FIELD.maxHeight
  ) {
    tune.field = { radius: Math.round(clamp(f.radius, 0, 48)) }
    why.fieldRadius = `your text field’s corners are ${Math.round(f.radius)}px`
  }
  return { tune, why }
}
