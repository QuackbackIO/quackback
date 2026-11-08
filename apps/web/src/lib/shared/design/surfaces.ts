/**
 * The surfaces a portal draws beyond the page, cards and raised parts, in a
 * mode: tinted Home blocks, vote boxes in a tint of the second colour, and
 * the footer's credit. The solver reads the site's text, links and focus
 * ring on each, and Theme > Colours lists the same pairs, so what one fixes
 * the other reports.
 */
import type { ThemeVariables } from '@/lib/shared/theme/types'
import { mixOklch, tintOf } from './color'
import { roleFill, type ColourRole } from './colour-roles'
import { overlay } from './contrast'
import type { PortalDesign } from './schema'
import { BLOCK_TINT } from './tints'

type Mode = 'light' | 'dark'

/** A tinted block's colour, as `color-mix(in oklch, fill BLOCK_TINT%, card)` paints it. */
export const blockTint = (fill: string, card: string) => mixOklch(fill, card, BLOCK_TINT / 100)

/** How far a vote box tinted with the second colour steps from the card. */
export const SUPPORT_TINT = 0.06

/** What the site's colours draw on a surface. */
export type Drawn = 'Text' | 'Secondary text' | 'Links' | 'The focus ring'

export interface Surface {
  /** What it is, as a pair names it, such as "tinted blocks". */
  on: string
  colour: string
  draws: Drawn[]
}

const ROLE_NAMES: Record<Exclude<ColourRole, 'accent'>, string> = {
  support: 'the second colour',
  extra1: 'the first extra colour',
  extra2: 'the second extra colour',
}

/** The second colour in a mode, when vote boxes take a tint of it. */
export function supportTintColour(doc: PortalDesign, card: string, mode: Mode): string | null {
  if (doc.layout.tint !== 'support') return null
  const support =
    mode === 'dark' ? (doc.brand.dark?.support ?? doc.brand.light.support) : doc.brand.light.support
  return support ? tintOf(support, card, SUPPORT_TINT) : null
}

/** Every surface the design draws the site's colours on, beyond the page, cards and raised parts. */
export function drawnSurfaces(
  doc: PortalDesign,
  t: Required<ThemeVariables>,
  mode: Mode
): Surface[] {
  const out: Surface[] = []
  const roles = new Set(
    doc.pages.home.blocks
      .filter((block) => block.look?.tone === 'tint')
      .map((block) => block.look?.colour ?? 'accent')
  )
  for (const role of roles) {
    const { fill } = roleFill(doc, t, mode, role)
    out.push({
      on: role === 'accent' ? 'tinted blocks' : `blocks tinted with ${ROLE_NAMES[role]}`,
      colour: blockTint(fill, t.card),
      draws: ['Text', 'Secondary text', 'Links', 'The focus ring'],
    })
  }
  const vote = supportTintColour(doc, t.card, mode)
  if (vote) out.push({ on: 'tinted vote boxes', colour: vote, draws: ['Text', 'Secondary text'] })
  // The credit's pill: the raised colour at half over the page (portal-footer.tsx).
  out.push({
    on: 'the footer',
    colour: overlay(t.muted, t.background, 0.5),
    draws: ['Secondary text'],
  })
  return out
}

/** The colours of the surfaces that draw `what`. */
export const surfacesDrawing = (surfaces: Surface[], what: Drawn) =>
  surfaces.filter((surface) => surface.draws.includes(what)).map((surface) => surface.colour)
