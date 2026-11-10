/**
 * The builder's curated sets: a short list of hero looks and font pairs the
 * Styles and Brand kit panels offer in place of every option. A set names the
 * full group of design fields it writes. A design whose fields match no set,
 * such as one Quackback AI or a website import made, reads as Custom; reading
 * never writes, so those values stay until someone picks a set.
 */
import type { DesignElement } from './elements'
import { closestWeight, type BundledFontId } from './fonts'
import type { PortalPageGates } from './paths'
import type { PortalDesign } from './schema'
import { layoutValue } from './defaults'

type Layout = PortalDesign['layout']

/**
 * The hero fields a look writes, each one left out set back to its default.
 * The design stores the hero under its older name, band. Height is the hero's
 * own setting beside its look, so a look keeps it.
 */
type BandFields = Pick<Layout, 'band' | 'blend' | 'bandShape' | 'bandArt'>

export interface BandLook {
  id: string
  label: string
  fields: BandFields
  /** Drawn with the second colour, so offered once the brand has one. */
  needsSecond?: boolean
}

export const BAND_LOOKS: readonly BandLook[] = [
  { id: 'plain', label: 'Plain', fields: { band: 'none' } },
  { id: 'tint', label: 'Tint', fields: { band: 'tint' } },
  { id: 'fade', label: 'Fade', fields: { band: 'fade' } },
  { id: 'brand', label: 'Brand colour', fields: { band: 'brand' } },
  {
    id: 'brand-waves',
    label: 'Brand colour with waves',
    fields: { band: 'brand', bandArt: 'waves' },
  },
  { id: 'inset', label: 'Brand colour panel', fields: { band: 'brand', bandShape: 'inset' } },
  { id: 'second', label: 'Second colour', fields: { band: 'support' }, needsSecond: true },
  { id: 'blend', label: 'Blend', fields: { band: 'blend' } },
]

/** The band fields a look sets back to their defaults (DESIGN_DEFAULTS) before writing its own. */
const BAND_OPTIONAL = ['blend', 'bandShape', 'bandArt'] as const

/** The band fields that draw: a blend's run only on a blend, art only on a band with colour. */
function drawnBand(fields: BandFields): Required<BandFields> {
  const band = fields.band
  return {
    band,
    blend: band === 'blend' ? layoutValue(fields, 'blend') : 'linear',
    bandShape: layoutValue(fields, 'bandShape'),
    bandArt: band === 'none' ? 'none' : layoutValue(fields, 'bandArt'),
  }
}

/** The hero look a design's hero makes, or null for Custom. */
export function bandLookOf(design: PortalDesign): string | null {
  const drawn = drawnBand(design.layout)
  const found = BAND_LOOKS.find((look) => {
    const wanted = drawnBand(look.fields)
    return (Object.keys(wanted) as Array<keyof BandFields>).every(
      (key) => wanted[key] === drawn[key]
    )
  })
  return found?.id ?? null
}

/** Writes every hero field of a look into a draft. */
export function takeBandLook(draft: PortalDesign, id: string): void {
  const look = BAND_LOOKS.find((each) => each.id === id)
  if (!look) return
  const layout = draft.layout as Record<string, unknown>
  for (const key of BAND_OPTIONAL) delete layout[key]
  Object.assign(draft.layout, look.fields)
}

export interface FontPair {
  id: string
  label: string
  heading: BundledFontId
  body: BundledFontId
}

export const FONT_PAIRS: readonly FontPair[] = [
  { id: 'clean', label: 'Clean', heading: 'inter', body: 'inter' },
  { id: 'studio', label: 'Studio', heading: 'bricolage-grotesque', body: 'inter' },
  { id: 'editorial', label: 'Editorial', heading: 'fraunces', body: 'inter' },
  { id: 'friendly', label: 'Friendly', heading: 'nunito', body: 'nunito' },
  { id: 'technical', label: 'Technical', heading: 'ibm-plex-sans', body: 'ibm-plex-sans' },
  { id: 'modern', label: 'Modern', heading: 'geist', body: 'geist' },
  { id: 'bookish', label: 'Bookish', heading: 'lora', body: 'inter' },
  { id: 'bold', label: 'Bold', heading: 'poppins', body: 'poppins' },
  { id: 'elegant', label: 'Elegant', heading: 'playfair', body: 'source-serif' },
  { id: 'geometric', label: 'Geometric', heading: 'space-grotesk', body: 'dm-sans' },
  { id: 'sturdy', label: 'Sturdy', heading: 'roboto-slab', body: 'roboto' },
  { id: 'poster', label: 'Poster', heading: 'oswald', body: 'inter' },
]

/** The font pair a design's fonts make, or null for Custom: an upload, a headline face of its own, or a mix. */
export function fontPairOf(design: PortalDesign): string | null {
  const { heading, body, display } = design.brand.fonts
  if (display || heading.kind !== 'bundled' || body.kind !== 'bundled') return null
  return FONT_PAIRS.find((pair) => pair.heading === heading.id && pair.body === body.id)?.id ?? null
}

/** Writes a pair's fonts into a draft: both faces, no headline face of its own, a weight the heading has. */
export function takeFontPair(draft: PortalDesign, id: string): void {
  const pair = FONT_PAIRS.find((each) => each.id === id)
  if (!pair) return
  const fonts = draft.brand.fonts
  fonts.heading = { kind: 'bundled', id: pair.heading }
  fonts.body = { kind: 'bundled', id: pair.body }
  delete fonts.display
  fonts.headingWeight = closestWeight(fonts.heading, fonts.headingWeight)
}

/** The parts styled the same on every page, the most used first. */
const PARTS: readonly DesignElement[] = [
  'button',
  'card',
  'vote',
  'status',
  'menu',
  'field',
  'link',
  'secondary',
  'headline',
  'subtitle',
  'heading',
  'body',
  'logo',
]

/** The parts the portal draws with the modules that are on: vote boxes with Feedback, status with Feedback or Roadmap. */
export function partsInUse(gates: PortalPageGates): DesignElement[] {
  return PARTS.filter((part) => {
    if (part === 'vote') return gates.feedback
    if (part === 'status') return gates.feedback || gates.roadmap
    return true
  })
}
