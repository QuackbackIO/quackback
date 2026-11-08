/**
 * What a look's tile draws: a design's page, hero band, heading face and
 * cards, in the colours the portal would show after the contrast solver, so
 * the hero letters on a tile read as the hero itself does.
 */
import { bandContrast } from './components'
import { fontStack } from './fonts'
import { resolveDesignCached } from './resolve'
import type { PortalDesign } from './schema'

export interface LookTile {
  page: string
  ink: string
  /** The hero band's colour, or 'transparent' where the look has none. */
  band: string
  /** The hero's headline colour on the band (or on the page with no band). */
  bandInk: string
  /** The plain colour behind the headline where it reads worst. */
  behind: string
  surface: string
  heading: string
  weight: number
  corners: PortalDesign['shape']['corners']
  cards: PortalDesign['layout']['cards']
}

/** A design drawn small, in the mode it opens in. */
export function lookTile(design: PortalDesign): LookTile {
  const resolved = resolveDesignCached(design)
  const mode = resolved.light ? 'light' : 'dark'
  const vars = (resolved[mode] ?? resolved.light ?? resolved.dark)!
  const tokens = resolved.tokens[mode]
  const page = vars.background ?? '#ffffff'
  const ink = vars.foreground ?? '#0a0a0a'
  const hero = bandContrast(design, vars, mode)
  return {
    page,
    ink,
    band: hero ? (tokens['--qb-band-bg'] ?? hero.background) : 'transparent',
    bandInk: hero?.ink ?? ink,
    behind: hero?.background ?? page,
    surface: vars.card ?? page,
    heading: fontStack(design.brand.fonts.heading),
    weight: design.brand.fonts.headingWeight,
    corners: design.shape.corners,
    cards: design.layout.cards,
  }
}
